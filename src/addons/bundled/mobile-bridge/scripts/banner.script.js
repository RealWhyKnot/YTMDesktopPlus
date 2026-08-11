// Shows or hides the "playing on your phone" strip by the player bar. Takes
// { action: "show", track: { title, author, thumbnailUrl } } or
// { action: "hide" }; idempotent so re-running after a page reload is safe.
// Styling lives in the addon's injected CSS.
(function (arg) {
  const ID = "ytmd-phone-banner";
  const existing = document.getElementById(ID);
  if (!arg || arg.action !== "show" || !arg.track) {
    if (existing) existing.remove();
    return true;
  }

  let banner = existing;
  if (!banner) {
    banner = document.createElement("div");
    banner.id = ID;
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
  banner.querySelector(".ytmd-phone-banner-title").textContent = track.title || "";
  banner.querySelector(".ytmd-phone-banner-subtitle").textContent = track.author || "";
  const art = banner.querySelector(".ytmd-phone-banner-art");
  if (track.thumbnailUrl) {
    art.src = track.thumbnailUrl;
    art.style.display = "";
  } else {
    art.removeAttribute("src");
    art.style.display = "none";
  }
  return true;
});
