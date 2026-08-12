import { Notification, NotificationConstructorOptions, nativeImage } from "electron";
import playerStateStore, { playerEvents, Thumbnail, VideoDetails, VideoState } from "../../player-state-store";
import IIntegration from "../integration";
import https from "https";

// Visualiser - https://apps.microsoft.com/store/detail/notifications-visualizer/9NBLGGH5XSL1?hl=en-gb&gl=gb&rtc=1
// Documentation / Examples - https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/adaptive-interactive-toasts?tabs=xml

function getLowestResThumbnail(thumbnails: Thumbnail[]) {
  let currentWidth = 1024;
  let currentHeight = 1024;
  let url = null;
  for (const thumbnail of thumbnails) {
    // If the thumbnail is smaller than the current one, but bigger than 100x100
    if (thumbnail.width < currentWidth && thumbnail.height < currentHeight && thumbnail.width > 100 && thumbnail.height > 100) {
      currentWidth = thumbnail.width;
      currentHeight = thumbnail.height;
      url = thumbnail.url;
    }
  }
  return url;
}

function displayNotification(videoDetails: VideoDetails, imageData: string) {
  const notificationData: NotificationConstructorOptions = {
    title: videoDetails.title,
    body: videoDetails.author,
    silent: true,
    urgency: "low" // Linux only
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

/**
 *
 * @param url
 * @returns Promise<string>
 */
function getUrlContents(url: string) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, res => {
      const data: Array<Buffer> = [];
      res.on("data", chunk => {
        data.push(chunk);
      });

      res.on("end", () => {
        resolve(Buffer.concat(data).toString("base64"));
      });
      res.on("error", err => {
        reject(err);
      });
    });

    request.on("error", function (e) {
      reject(e);
    });
  });
}

export default class NowPlayingNotifications implements IIntegration {
  private isEnabled = false;
  private lastDetails: VideoDetails = null;

  // Derived events fire only on track or play-state transitions, so this runs
  // a handful of times per song instead of on every progress tick.
  private evaluate = (): void => {
    if (!this.isEnabled) {
      return;
    }

    const state = playerStateStore.getState();
    if (state.videoDetails && state.trackState === VideoState.Playing) {
      if (this.lastDetails && this.lastDetails.id === state.videoDetails.id) {
        return;
      }

      this.lastDetails = state.videoDetails;

      if (state.videoDetails.thumbnails && state.videoDetails.thumbnails.length > 0) {
        getUrlContents(getLowestResThumbnail(state.videoDetails.thumbnails))
          .then(function (data: string) {
            displayNotification(state.videoDetails, data);
          })
          .catch(function () {
            displayNotification(state.videoDetails, null);
          });
      } else {
        displayNotification(state.videoDetails, null);
      }
    }
  };

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
