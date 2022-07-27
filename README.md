# quiescent

Why: Long term documents, where the product and source both contain a humane readable document.

The frontend for authoring new post which can operate locally and remotely on a git repository. This would actually allow 
the user to view the history of a post and who authored it.

Writing posts (as code) should be streamlined and extensible.
Write posts as markdown or react components allowing you to build as simple or complex of a post as you'd like.
Ideally these tools should work regardless of (react) framework.

- Next.JS - Server Side Render/Static Site Generation
- Remix - Server Sie Rendered

A build manifest is important here to be able to do efficient lookups without having to walk the filesystem per request.

## Post File or Bundle

- Posts Consist of
  - a single markdown file
  - a single html file
  - a react component
- Media should be stored using Git LFS

## Posts Directory

- Posts are organized into folders by year.
- Each post folder or file is ordered by YYYY-MM-DD
- During build time a manifest is generated for fast lookups

## Tooling

- CLI to create a new post
- Build tools to generate manifest

## Unanswered questions

- HMR..? - Ideally for a pure markdown file


## Other Ideas
- 
- Grammerly / proofreading
