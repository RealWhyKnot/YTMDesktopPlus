export function coalesce(run: () => void): () => void {
  let isPending = false;
  return () => {
    if (isPending) return;
    isPending = true;
    setTimeout(() => {
      isPending = false;
      run();
    });
  };
}
