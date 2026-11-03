export function runScript(arg: unknown) {
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
  const ID = "ytmd-phone-banner";
  const existing = document.getElementById(ID);
  if (!isRecord(arg) || arg.action !== "show" || !isRecord(arg.track)) {
    if (existing) existing.remove();
    return true;
  }

  let banner = existing;
  if (!banner) {
    banner = document.createElement("div");
    banner.id = ID;
    banner.className = "ytmd-phone-banner";
    const art = document.createElement("img");
    art.className = "ytmd-phone-banner-art";
    art.alt = "";
    const text = document.createElement("div");
    text.className = "ytmd-phone-banner-text";
    const title = document.createElement("div");
    title.className = "ytmd-phone-banner-title";
    const subtitle = document.createElement("div");
    subtitle.className = "ytmd-phone-banner-subtitle";
    const caption = document.createElement("div");
    caption.className = "ytmd-phone-banner-caption";
    caption.textContent = "Playing on your phone";
    text.append(title, subtitle, caption);
    banner.append(art, text);
    document.body.appendChild(banner);
  }

  const track = arg.track;
  const title = banner.querySelector(".ytmd-phone-banner-title");
  const subtitle = banner.querySelector(".ytmd-phone-banner-subtitle");
  if (title) title.textContent = typeof track.title === "string" ? track.title : "";
  if (subtitle) subtitle.textContent = typeof track.author === "string" ? track.author : "";
  const art = banner.querySelector(".ytmd-phone-banner-art");
  if (!(art instanceof HTMLImageElement)) return true;
  if (typeof track.thumbnailUrl === "string" && track.thumbnailUrl) {
    art.src = track.thumbnailUrl;
    art.removeAttribute("data-hidden");
  } else {
    art.removeAttribute("src");
    art.setAttribute("data-hidden", "");
  }
  return true;
}
