import Link from "next/link";
import { Post } from "../../types";

const PostsRoute: React.FC<{ posts: Post[] }> = (props) => {
  return (
    <div>
      {Object.entries(props.posts).map(([slug, post]) => (
        <div key={slug}>
          <span>
            <Link href={`/posts/${slug}`}>{post.title}</Link>
          </span>
          <br />
          <p>{post.description}</p>
        </div>
      ))}
    </div>
  );
};

export default PostsRoute;
