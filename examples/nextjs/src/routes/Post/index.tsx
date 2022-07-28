import { Post } from "../../types";
import { useRouter } from "next/router";
import { ImageGallery } from "@quiescent/components";

const PostRoute: React.FC<{ post: Post }> = (props) => {
  return (
    <div>
      Post
      <ImageGallery />
    </div>
  );
};

export default PostRoute;
