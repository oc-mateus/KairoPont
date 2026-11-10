import { Component } from 'react';

export default class AppErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { console.error('Não foi possível renderizar a aplicação.'); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="public-state-page"><h1>Não foi possível abrir esta tela</h1><p>Recarregue a página. Se o problema continuar, entre em contato com o suporte.</p><div className="public-state-actions"><button className="btn btn-primary" onClick={() => window.location.reload()}>Recarregar</button><a className="btn btn-secondary" href={`${import.meta.env.BASE_URL}suporte`}>Buscar ajuda</a></div></main>;
  }
}
