module.exports = (robot) => {
  // New PR is opened
  robot.on(['pull_request.opened', 'issues.opened'], async context => {
    const params = labelParams(context, { labels: ["stalebot/waiting-for/maintainer"] })
    const result = await context.github.issues.addLabels(params)
    return result
  })

  // Maintainer comments/reviews
  robot.on(['issue_comment.created', 'pull_request_review.submitted', 'pull_request_review_comment.created'], async context => {
    if (await is_maintainer(context)){
      await context.github.issues.addLabels(labelParams(context, {labels: ["stalebot/waiting-for/author"]}))
      await context.github.issues.removeLabel(labelParams(context, {name: "stalebot/waiting-for/maintainer"}))
    }
  })

  // App is installed on a repo
  robot.on('installation.created', async context => {
    await createLabels(context, context.payload.repositories)
  })

  // App is installed on a specific repo?
  robot.on('installation_repositories.added', async context => {
    await createLabels(context, context.payload.repositories_added)
  })

  // Original Issue author comments.
  robot.on('issue_comment.created', async context => {
    let commentAuthor = context.payload.sender.login
    let issueAuthor = context.payload.comment.user.login
    if (commentAuthor == issueAuthor) {
      context.github.issues.removeLabel({
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        number: context.payload.issue.number,
        name: "stalebot/waiting-for/author"
      })
      context.github.issues.addLabels({
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        number: context.payload.issue.number,
        labels: ["stalebot/waiting-for/maintainer"]
      })
    }
  })
}


// Check if commenter is a maintainer
async function is_maintainer(context) {
  owner = context.payload.repository.owner.login
  username = username(context)
  repo = repoName(context)
  const result = await context.github.repos.reviewUserPermissionLevel({owner, repo, username})

  permission = result.data.permission
  return permission == "admin" || permission == "write"
}

// Create params for adding or removing a label
function labelParams(context, label_names) {
  params = {
    owner: context.payload.repository.owner.login,
    repo: repoName(context),
    number: issueOrPRNumber(context),
  }
  return Object.assign(params, label_names)
}

// Find username for issue or review
function username(context) {
  if (context.payload.issue) {
    return context.payload.issue.user.login
  } else {
    return context.payload.review.user.login
  }
}

// Find repo name for issue or review
function repoName(context) {
  if (context.payload.repository) {
    return context.payload.repository.name
  } else {
    return context.payload.repo.name
  }
}

// Find issue or PR number
function issueOrPRNumber(context) {
  if (context.payload.issue) {
    return context.payload.issue.number
  } else {
    return context.payload.pull_request.number
  }
}

let labels = [
  {name: "stalebot/waiting-for/maintainer", color: "cccccc"},
  {name: "stalebot/waiting-for/author", color: "cccccc"},
  {name: "stalebot/status/fresh", color: "5dcc77"},
  {name: "stalebot/status/needs-attention", color: "f9dc5c"},
  {name: "stalebot/status/stale", color: "ff8552"},
  {name: "stalebot/status/dire", color: "da344d"}
]

// create labels in new repo
// todo(nick): does not check if labels exist.
async function createLabels(context, repos) {
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
