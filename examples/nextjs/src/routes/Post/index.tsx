import { Post } from "../../types";
import { useRouter } from "next/router";

const PostRoute: React.FC<{ post: Post }> = (props) => {
  const router = useRouter();

  return (
    <div>
      <h1>{props.post.description}</h1>
      <p>{props.post.content}</p>
    </div>
  );
};

export default PostRoute;
