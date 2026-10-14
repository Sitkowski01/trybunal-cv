import { Component, type ReactNode } from "react";

/**
 * Granica bledu sali 3D: gdy model sie nie wczyta albo WebGL odmowi pracy, wyjatek z wnetrza sceny
 * nie moze wywrocic calej strony. Zostaje komunikat, a widok 2D pod spodem dziala dalej.
 */
export class SceneBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return <p className="stage__loading">Nie udało się wczytać sali 3D — przebieg rozprawy jest poniżej.</p>;
    }
    return this.props.children;
  }
}
