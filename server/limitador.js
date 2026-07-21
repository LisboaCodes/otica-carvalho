// Limitador de tentativas por IP, em memoria.
// Protege o login contra forca bruta e a consulta publica contra varredura de CPFs.

const janelas = new Map();

export function criarLimitador({ limite, janelaMs, mensagem }) {
  return function limitar(req, res, proximo) {
    const chave = `${req.baseUrl}${req.path}|${req.ip}`;
    const agora = Date.now();
    const tentativas = (janelas.get(chave) ?? []).filter((t) => agora - t < janelaMs);

    if (tentativas.length >= limite) {
      const esperaSegundos = Math.ceil((janelaMs - (agora - tentativas[0])) / 1000);
      res.setHeader('Retry-After', String(esperaSegundos));
      return res.status(429).json({ erro: mensagem, espera_segundos: esperaSegundos });
    }

    tentativas.push(agora);
    janelas.set(chave, tentativas);
    proximo();
  };
}

/** Zera o contador apos uma tentativa bem-sucedida. */
export function liberar(req) {
  janelas.delete(`${req.baseUrl}${req.path}|${req.ip}`);
}

// Descarta janelas antigas para o Map nao crescer sem limite.
const limpeza = setInterval(() => {
  const agora = Date.now();
  for (const [chave, tentativas] of janelas) {
    if (tentativas.every((t) => agora - t > 60 * 60 * 1000)) janelas.delete(chave);
  }
}, 10 * 60 * 1000);
limpeza.unref();
