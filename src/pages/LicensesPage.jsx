import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LegalLinks from '../components/LegalLinks';

const noticesUrl = `${import.meta.env.BASE_URL}licenses/third-party-notices.txt`;

function parseNotices(text) {
  const sections = text.replace(/\r\n/g, '\n').split(/^={72}\n/gm).slice(1).map((section) => section.trim());
  return [...new Set(sections)].map((section, id) => {
    const [name, license, ...body] = section.split('\n');
    return { id, name, license: license.replace(/^Licença declarada:\s*/, ''), text: body.join('\n').trim() };
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export default function LicensesPage() {
  const [notices, setNotices] = useState([]);
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    async function loadNotices() {
      try {
        const response = await fetch(noticesUrl, { signal: controller.signal });
        if (!response.ok) throw new Error('Notices unavailable');
        const entries = parseNotices(await response.text());
        if (!entries.length) throw new Error('No notices found');
        if (controller.signal.aborted) return;
        setNotices(entries);
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted) setStatus('error');
      }
    }
    loadNotices();
    return () => controller.abort();
  }, [attempt]);

  const search = query.trim().toLocaleLowerCase('pt-BR');
  const filtered = notices.filter(({ name, license }) => `${name} ${license}`.toLocaleLowerCase('pt-BR').includes(search));

  return (
    <main className="legal-page">
      <article className="legal-document">
        <header className="legal-header">
          <Link className="legal-brand-lockup" to="/" aria-label="KairoPont, início">
            <img src={`${import.meta.env.BASE_URL}assets/brand/web/mark-96.webp`} width="42" height="42" alt="" />
            <span><strong>KairoPont</strong><small>Controle de ponto</small></span>
          </Link>
          <h1>Licenças de terceiros</h1>
          <p className="legal-intro">Bibliotecas e fontes que fazem parte do KairoPont.</p>
        </header>
        <div className="legal-body">
          <p>Os direitos sobre esses componentes pertencem aos respectivos titulares. Abra um item para consultar o texto original da licença e os avisos de autoria.</p>
          <p><a className="legal-back-link" href={noticesUrl} download="kairopont-licencas.txt">Baixar todas as licenças (.txt)</a></p>
          {status === 'loading' && <p role="status">Carregando licenças…</p>}
          {status === 'error' && (
            <div>
              <p role="alert">Não foi possível carregar as licenças. Tente novamente ou baixe o arquivo acima.</p>
              <button className="btn btn-secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</button>
            </div>
          )}
          {status === 'ready' && (
            <>
              <div className="licenses-search">
                <label htmlFor="license-search">Buscar biblioteca ou licença</label>
                <input id="license-search" className="form-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: React, MIT, Apache" />
                <p role="status">{filtered.length} de {notices.length} componentes</p>
              </div>
              {filtered.length === 0 && <p>Nenhum componente encontrado. Tente outro nome ou tipo de licença.</p>}
              <div className="licenses-list">
                {filtered.map(({ id, name, license, text }) => (
                  <details className="license-entry" key={id}>
                    <summary><span className="license-name">{name}</span><span className="license-type">{license}</span></summary>
                    <pre className="license-text">{text}</pre>
                  </details>
                ))}
              </div>
            </>
          )}
        </div>
        <footer className="legal-footer">
          <Link className="legal-back-link" to="/">Voltar ao início</Link>
          <LegalLinks />
        </footer>
      </article>
    </main>
  );
}
