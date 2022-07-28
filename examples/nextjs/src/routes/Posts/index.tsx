import Link from "next/link";
import { Post } from "../../types";

const PostsRoute: React.FC<{ posts: Post[] }> = (props) => {
  console.log("AYE POSTS", props.posts);
  return (
    <div>
      Posts:
      {Object.entries(props.posts).map(([slug, post]) => (
        <div key={slug}>
          SLUG {slug} <Link href={`/posts/${slug}`}>{slug}</Link>
        </div>
      ))}
    </div>
  );
};

export default PostsRoute;
