import Link from "next/link";
import { Post } from "../../types";

const PostsRoute: React.FC<{ documentType: string; documents: Post[] }> = (
  props
) => {
  return (
    <div>
      {Object.entries(props.documents).map(([slug, post]) => (
        <div key={slug}>
          <span>
            <Link href={`/${props.documentType}/${slug}`}>{post.title}</Link>
          </span>
          <br />
          <p>{post.description}</p>
        </div>
      ))}
    </div>
  );
};

export default PostsRoute;
