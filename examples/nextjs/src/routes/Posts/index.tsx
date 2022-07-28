const PostsRoute: React.FC<{ posts: Record<string, string>[] }> = (props) => {
  console.log("AYE POSTS", props.posts);
  return (
    <div>
      Posts:
      {Object.entries(props.posts).map(([slug, post]) => (
        <div key={slug}>SLUG {slug}</div>
      ))}
    </div>
  );
};

export default PostsRoute;
