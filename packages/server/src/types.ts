export interface Document {
  title: string;
  description: string;
  content: string;
  date: string;
  slug: string;
  tags?: string[];
}

export interface Manifest {
  documents: Record<string, Document>;
  tags: Record<string, number>;
}
