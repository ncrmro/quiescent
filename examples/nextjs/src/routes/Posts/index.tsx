import Link from "next/link";
import { Post } from "../../types";

const PostsRoute: React.FC<{ posts: Post[] }> = (props) => {
  const documents = props.posts || [];
  return (
    <div>
      {documents.map((post) => (
        <div key={post.slug}>
          <span>
            <Link href={`/posts/${post.slug}`}>{post.title}</Link>
          </span>
          <br />
          <p>{post.description}</p>
        </div>
      ))}
    </div>
  );
};

export default PostsRoute;
