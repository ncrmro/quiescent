import { GetStaticProps } from "next";
import { getDocuments, getManifest } from "@quiescent/server";
import { Post } from "../../types";

export { default as default } from "../../routes/Posts";

export const getStaticProps: GetStaticProps<{ posts: Post[] }> = async () => {
  const posts = await getDocuments("posts", "dynamic");
  return {
    props: { posts },
  };
};
