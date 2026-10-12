/** Problemy walidacji dla czlowieka: sciezka pola i komunikat; blad calego obiektu jako "(calosc)". */
export function describeIssues(issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]): string[] {
  return issues.map((i) => `${i.path.map(String).join(".") || "(calosc)"}: ${i.message}`);
}
