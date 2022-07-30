import { GetStaticProps } from "next";
import Link from "next/link";
import { Manifest } from "@quiescent/server";

const DocumentListItem: React.FC<{
  href: string;
  manifest: Manifest;
  children: string;
}> = (props) => {
  const tags = Object.keys(props.manifest.tags);
  return (
    <li style={{ display: "flex", flexDirection: "column" }}>
      <Link href={props.href}>{props.children}</Link>
      <div>
        {tags.map((tag) => (
          <Link key={tag} href={`${props.href}/category/${tag}`}>
            {tag}
          </Link>
        ))}
      </div>
    </li>
  );
};

const IndexPage: React.FC<{
  post: Manifest;
  job: Manifest;
  recipe: Manifest;
}> = (props) => {
  return (
    <div>
      <h1>Document Types</h1>
      <ul>
        <DocumentListItem manifest={props["posts"]} href="/posts">
          Posts
        </DocumentListItem>
        <DocumentListItem manifest={props["jobs"]} href="/jobs">
          Jobs
        </DocumentListItem>
        <DocumentListItem manifest={props["recipes"]} href="/recipes">
          Recipes
        </DocumentListItem>
      </ul>
    </div>
  );
};

export const getStaticProps: GetStaticProps = async (context) => {
  // Importing server code
  const { getManifest } = await import("@quiescent/server");
  // We use promise all when fetching multiple document manifests
  const [posts, jobs, recipes] = await Promise.all([
    getManifest("posts", "dynamic"),
    getManifest("jobs", "dynamic"),
    getManifest("recipes", "dynamic"),
  ]);
  return {
    props: { posts, jobs, recipes },
  };
};

export default IndexPage;
