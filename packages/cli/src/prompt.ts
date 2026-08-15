import { createInterface } from "node:readline/promises";

export type CliPrompt = {
  input(message: string, defaultValue?: string): Promise<string>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  select(message: string, choices: { label: string; value: string }[]): Promise<string>;
};

export function terminalPrompt(): CliPrompt {
  const ask = async (message: string): Promise<string> => {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return (await terminal.question(message)).trim();
    } finally {
      terminal.close();
    }
  };
  return {
    async input(message, defaultValue) {
      const answer = await ask(`${message}${defaultValue ? ` (${defaultValue})` : ""}: `);
      return answer || defaultValue || "";
    },
    async confirm(message, defaultValue = false) {
      const marker = defaultValue ? "Y/n" : "y/N";
      const answer = (await ask(`${message} [${marker}] `)).toLowerCase();
      if (!answer) return defaultValue;
      return answer === "y" || answer === "yes";
    },
    async select(message, choices) {
      process.stdout.write(`${message}\n`);
      choices.forEach((choice, index) => process.stdout.write(`  ${index + 1}. ${choice.label}\n`));
      const answer = await ask("Choose a number: ");
      const index = Number.parseInt(answer, 10) - 1;
      if (!Number.isInteger(index) || !choices[index]) throw new Error("Invalid selection");
      return choices[index].value;
    },
  };
}
