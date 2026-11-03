import { Notification, type NotificationConstructorOptions, nativeImage } from "electron";
import { playerStateStore, playerEvents, type Thumbnail, type VideoDetails, VideoState } from "../../player-state-store";
import type { Integration } from "../integration";
import { launchPauseArmedFor } from "../../playback/launch-pause";
import log from "electron-log";
import https from "https";

function getLowestResThumbnail(thumbnails: Thumbnail[]) {
  let currentWidth = 1024;
  let currentHeight = 1024;
  let url = null;
  for (const thumbnail of thumbnails) {
    if (thumbnail.width < currentWidth && thumbnail.height < currentHeight && thumbnail.width > 100 && thumbnail.height > 100) {
      currentWidth = thumbnail.width;
      currentHeight = thumbnail.height;
      url = thumbnail.url;
    }
  }
  return url;
}

function displayNotification(videoDetails: VideoDetails, imageData: string | null) {
  const notificationData: NotificationConstructorOptions = {
    title: videoDetails.title,
    body: videoDetails.author,
    silent: true,
    urgency: "low",
  };

  if (imageData !== null) {
    const notificationImage = nativeImage.createFromDataURL("data:image/jpeg;base64," + imageData);

    notificationData.icon = notificationImage;
  }

  const notification = new Notification(notificationData);
  notification.show();
  setTimeout(() => {
    notification.close();
  }, 5 * 1000);
}

function getUrlContents(url: string | null) {
  return new Promise<string>((resolve, reject) => {
    if (url === null) {
      reject(new Error("Notification thumbnail is unavailable"));
      return;
    }
    const request = https.get(url, (res) => {
      const data: Buffer[] = [];
      res.on("data", (chunk: unknown) => {
        if (!Buffer.isBuffer(chunk)) {
          reject(new TypeError("Notification thumbnail response contained a non-buffer chunk"));
          return;
        }
        data.push(chunk);
      });

      res.on("end", () => {
        resolve(Buffer.concat(data).toString("base64"));
      });
      res.on("error", (err) => {
        reject(err);
      });
    });

    request.on("error", function (e) {
      reject(e);
    });
  });
}

export class NowPlayingNotifications implements Integration {
  private isEnabled = false;
  private lastDetails: VideoDetails | null = null;

  private evaluate = (): void => {
    try {
      this.showIfNewTrack();
    } catch (error) {
      log.error("Now playing notification failed", error);
    }
  };

  private showIfNewTrack(): void {
    if (!this.isEnabled) {
      return;
    }

    const state = playerStateStore.getState();
    const details = state.videoDetails;
    if (details && state.trackState === VideoState.Playing) {
      if (this.lastDetails?.id === details.id) {
        return;
      }
      if (launchPauseArmedFor() === details.id) {
        return;
      }

      this.lastDetails = details;

      if (details.thumbnails.length > 0) {
        getUrlContents(getLowestResThumbnail(details.thumbnails))
          .then(function (data: string) {
            displayNotification(details, data);
          })
          .catch(function () {
            displayNotification(details, null);
          })
          .catch((error: unknown) => log.error("Now playing notification failed", error));
      } else {
        displayNotification(details, null);
      }
    }
  }

  public provide(): void {
    throw new Error("Method not implemented.");
  }

  public enable(): void {
    if (!this.isEnabled) {
      playerEvents.on("trackChanged", this.evaluate);
      playerEvents.on("playStateChanged", this.evaluate);
      this.isEnabled = true;
    }
  }
  public disable(): void {
    if (this.isEnabled) {
      playerEvents.off("trackChanged", this.evaluate);
      playerEvents.off("playStateChanged", this.evaluate);
      this.isEnabled = false;
    }
  }
}
