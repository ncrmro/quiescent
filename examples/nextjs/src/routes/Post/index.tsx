import { MDXPost } from "../../types";
import { MDXRemote } from "next-mdx-remote";

const components = {};
const PostRoute: React.FC<{ post: MDXPost }> = (props) => {
  return (
    <div>
      <h1>{props.post.title}</h1>
      <MDXRemote {...props.post.content} components={components} />
    </div>
  );
};

export default PostRoute;
