import { Post } from "../../types";
import { Markdown } from "@quiescent/components";

const PostRoute: React.FC<{ post: Post }> = (props) => {
  return (
    <div>
      Post
      <Markdown>{props.post.content}</Markdown>
    </div>
  );
};

export default PostRoute;
