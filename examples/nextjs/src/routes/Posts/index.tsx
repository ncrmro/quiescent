const PostsRoute: React.FC<{ posts: Record<string, string>[] }> = (props) => {
  return (
    <div>
      Posts:
      <ul>
        {props.posts.map((post) => (
          <li key={post.slug}>{post.slug}</li>
        ))}
      </ul>
    </div>
  );
};

export default PostsRoute;
