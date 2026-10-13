import { wordDiff } from "@trybunal/domain";

/**
 * Poprawka punktu CV slowo po slowie (diff z domeny). Usuniete i dodane fragmenty to <del>
 * i <ins> — czytnik ekranu je oglasza, a kolor nie jest jedynym nosnikiem znaczenia.
 */
export function DiffText({ before, after }: { readonly before: string; readonly after: string }) {
  return (
    <p className="diff">
      {wordDiff(before, after).map((part, i) => {
        // Stryker disable next-line StringLiteral: klucz Reacta - lista nie zmienia sie w miejscu.
        const key = `${String(i)}-${part.kind}`;
        if (part.kind === "removed") return <del key={key}>{part.text}</del>;
        if (part.kind === "added") return <ins key={key}>{part.text}</ins>;
        return <span key={key}>{part.text}</span>;
      })}
    </p>
  );
}
