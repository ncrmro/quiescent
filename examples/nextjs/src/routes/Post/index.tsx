import { Post } from "../../types";
import { Markdown } from "@quiescent/components";

const PostRoute: React.FC<{ post: Post }> = (props) => {
  return (
    <div>
      <h1>{props.post.title}</h1>
      <Markdown>{props.post.content}</Markdown>
    </div>
  );
};

export default PostRoute;
