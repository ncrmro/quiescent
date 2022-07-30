# @quiescent/server

## Config

From your project where you use the server and CLI packages we define a `quescent.json`. For a blog you would only add
the posts document type.

```json
{
  "documentTypes": {
    "jobs": {
      "directory": "public/jobs"
    },
    "posts": {
      "directory": "public/posts"
    },
    "recipes": {
      "recipes": "public/jobs"
    }
  }
}
```

## Manifest

The manifest is an object that we build dynamically or read from a JSON file depending the the mode the server package
is operating in.

The manifest looks like this and can be found ad the root for the documentType directory,
eg `public/posts/manifest.json`.

```json
{
  "documents": {
    "first-powered-flight": {
      "title": "Powered Flight Achieved",
      "description": "Today is the a pair of brothers of achieved flight!",
      "content": "\n\nThis is the first post.\n",
      "date": "1903-12-17",
      "slug": "first-powered-flight",
      "tags": [
        "news"
      ]
    }
  },
  "tags": {
    "news": [
      "first-powered-flight"
    ]
  }
}

```

The manifest allows us to efficiently do the following without having hit the desk each request.

- iterate over over all of out posts
- filter posts based on their category (primary tag)
