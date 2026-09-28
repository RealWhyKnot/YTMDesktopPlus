export function coalesce(run: () => void): () => void {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      run();
    });
  };
}
