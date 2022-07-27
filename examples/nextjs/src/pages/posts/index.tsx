import { GetStaticProps } from "next";
import { getPosts } from "@quiescent/server";

export { default as default } from "../../routes/Posts";

export const getStaticProps: GetStaticProps = async (context) => {
  const { getPosts } = await import("@quiescent/server");
  return {
    props: { posts: await getPosts() },
  };
};
