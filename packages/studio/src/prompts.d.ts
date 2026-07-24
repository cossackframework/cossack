declare module 'prompts' {
  interface Choice {
    title: string;
    value: string;
  }
  interface PromptQuestion {
    type: string;
    name: string;
    message: string;
    choices?: Choice[];
  }
  export default function prompts(question: PromptQuestion): Promise<Record<string, any>>;
}
