const createScheduler = require('probot-scheduler')
const moment = require('moment')

module.exports = (robot) => {
  createScheduler(robot)

  robot.on('schedule.repository', async context => {
    context.log(context.repo(), 'Running scheduled job to check issues for escalation.')

    const issues = context.github.issues.getForRepo(context.repo({
      state: 'open',
      label: 'stalebot/waiting-for/maintainer',
      per_page: 100
    }))

    await context.github.paginate(issues, async res => {
      res.data.forEach(async issue => {
        context.log({issue: issue.html_url}, 'Checking issue for escalation.')

        let lastAuthorComment

        const comments = await context.github.issues.getComments(
          context.repo({
            number: issue.number,
            per_page: 100
          })
        )

        await context.github.paginate(comments, async (res, stop) => {
          res.data.forEach(comment => {
            if (comment.user.id === issue.user.id) {
              lastAuthorComment = comment
              stop()
            }
          })
        })

        let currentLabel = issue.labels.find(label => label.name.startsWith('stalebot/status'))
        let newLabel

        const now = new Date()

        if (lastAuthorComment) {
          const lastCommentAt = moment(lastAuthorComment.create_at)
          const age = now - lastCommentAt / 1000 / 60 / 60 / 24

          if (age >= 90) {
            newLabel = 'stalebot/status/dire'
          } else if (age >= 15) {
            newLabel = 'stalebot/status/stale'
          } else if (age >= 1) {
            newLabel = 'stalebot/status/needs-attention'
          } else {
            newLabel = 'stalebot/status/fresh'
          }

          if (currentLabel && currentLabel.name !== newLabel) {
            await context.github.issues.removeLabel(context.repo({
              number: issue.number,
              name: currentLabel.name
            }))
          } else if (currentLabel && newLabel === currentLabel.name) {
            return
          }

          await context.github.issues.addLabels(context.repo({
            number: issue.number,
            labels: [newLabel]
          }))
        }
      })
    })
  })

  // App is installed on an org or user account
  robot.on('installation.created', async context => {
    await createLabels(context, context.payload.repositories)
  })

  // App is installed on additional repositories in an org
  robot.on('installation_repositories.added', async context => {
    await createLabels(context, context.payload.repositories_added)
  })

  // New issue or PR is opened
  robot.on(['pull_request.opened', 'issues.opened'], async context => {
    const params = context.issue({ labels: ['stalebot/waiting-for/maintainer'] })
    const result = await context.github.issues.addLabels(params)
    return result
  })

  // New comments from participants
  robot.on(['issue_comment.created', 'pull_request_review.submitted', 'pull_request_review_comment.created'], async context => {
    if (isAuthor(context)) {
      await context.github.issues.removeLabel(context.issue({name: 'stalebot/waiting-for/author'}))
      await context.github.issues.addLabels(context.issue({labels: ['stalebot/waiting-for/maintainer']}))
      // Do not consider authors as maintainers in the context of their own PRs/issues.
    } else if (await isMaintainer(context)) {
      await context.github.issues.addLabels(context.issue({labels: ['stalebot/waiting-for/author']}))
      await context.github.issues.removeLabel(context.issue({name: 'stalebot/waiting-for/maintainer'}))
    }
  })
}

// Check if commenter is a maintainer
async function isMaintainer (context) {
  const username = commenterUsername(context)
  const result = await context.github.repos.reviewUserPermissionLevel(context.repo({username}))

  const permission = result.data.permission
  return permission === 'admin' || permission === 'write'
}

// Check if commenter is the original author
function isAuthor (context) {
  let issueAuthor

  if (context.payload.issue) {
    issueAuthor = context.payload.issue.user.login
  } else if (context.payload.pull_request) {
    issueAuthor = context.payload.pull_request.user.login
  } else if (context.payload.review) {
    issueAuthor = context.payload.review.user.login
  }

  return issueAuthor === context.payload.sender.login
}

function commenterUsername (context) {
  if (context.payload.comment) {
    return context.payload.comment.user.login
  } else if (context.payload.issue) {
    return context.payload.issue.user.login
  } else {
    return context.payload.review.user.login
  }
}

let labels = [
  {name: 'stalebot/waiting-for/maintainer', color: 'cccccc'},
  {name: 'stalebot/waiting-for/author', color: 'cccccc'},
  {name: 'stalebot/status/fresh', color: '5dcc77'},
  {name: 'stalebot/status/needs-attention', color: 'f9dc5c'},
  {name: 'stalebot/status/stale', color: 'ff8552'},
  {name: 'stalebot/status/dire', color: 'da344d'}
]

// Create labels in new repo
// todo(nick): does not check if labels exist.
async function createLabels (context, repos) {
  repos.forEach(repo => {
    labels.forEach(label => {
      context.github.issues.createLabel({
        owner: context.payload.installation.account.login,
        repo: repo.name,
        name: label.name,
        color: label.color
      })
    })
  })
}
