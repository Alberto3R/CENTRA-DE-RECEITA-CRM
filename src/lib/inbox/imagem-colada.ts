// Imagem colada (Ctrl/Cmd+V) no compositor do inbox, como no WhatsApp Web:
// "Copiar imagem" num site põe a imagem na área de transferência e o chat
// anexa como foto.

/** Formatos que o bucket chat-media e a Meta aceitam como imagem. */
export const IMAGEM_ACEITA = ["image/png", "image/jpeg", "image/webp"];

/**
 * A imagem da área de transferência, ou `null` se o que foi colado é texto.
 *
 * Copiar de Word/Excel/Google Docs também põe uma "foto" do trecho junto
 * com o texto; nesse caso quem colou quer o texto, então só vale imagem
 * quando não há texto puro junto. "Copiar imagem" de um site traz a imagem
 * (e às vezes o HTML da <img>), sem text/plain.
 */
export function imagemDaAreaDeTransferencia(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  if (dt.getData("text/plain").trim()) return null;
  for (const item of Array.from(dt.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/**
 * Deixa a imagem colada pronta para upload: formato aceito e dentro do
 * limite. GIF/AVIF/BMP e capturas grandes viram JPEG (recomprimindo até
 * caber). O nome vem como "image.png" do navegador; troca por um legível.
 */
export async function prepararImagemColada(file: File, maxBytes: number): Promise<File> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  if (IMAGEM_ACEITA.includes(file.type) && file.size <= maxBytes) {
    const ext = file.type.split("/")[1].replace("jpeg", "jpg");
    return new File([file], `imagem-colada-${stamp}.${ext}`, { type: file.type });
  }

  const bitmap = await createImageBitmap(file);
  let scale = 1;
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    // JPEG não tem transparência: fundo branco, como o WhatsApp mostra PNG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );
    if (blob && blob.size <= maxBytes) {
      bitmap.close();
      return new File([blob], `imagem-colada-${stamp}.jpg`, { type: "image/jpeg" });
    }
    scale *= 0.75;
  }
  bitmap.close();
  throw new Error("Não foi possível reduzir a imagem colada para o limite de envio.");
}
