// Enregistrement automatique du canvas en vidéo, dans le navigateur (OBS reste la solution de repli).
// La vidéo sort à la résolution interne du jeu : 1080 x 1920.

const CANDIDATES = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

export interface Recording {
  readonly mimeType: string;
  /** Arrête l'enregistrement et télécharge le fichier. */
  stop(): Promise<Blob>;
}

export function pickMimeType(): string | undefined {
  return CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function startRecording(canvas: HTMLCanvasElement, filename: string, fps = 60): Recording {
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error("Ce navigateur ne sait pas enregistrer de vidéo (MediaRecorder) : utiliser OBS.");
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.onerror = (e) => console.error('[capture] erreur MediaRecorder', e);
  recorder.start(1000);

  return {
    mimeType,
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `${filename}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
          stream.getTracks().forEach((t) => t.stop());
          resolve(blob);
        };
        if (recorder.state === 'inactive') recorder.onstop?.(new Event('stop'));
        else recorder.stop();
      }),
  };
}
