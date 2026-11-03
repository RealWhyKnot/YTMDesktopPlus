import { pageMember, pageRecord, pageCall } from "./page-values";

export function installSleepTimer(playerBar: Element, miss: (what: string, detail?: unknown) => void): void {
  let sleepTimerTimeout: ReturnType<typeof setTimeout> | null = null;
  const rightControls = playerBar.querySelector(".right-controls-buttons");
  const sleepTimerButton = document.createElement("yt-icon-button");

  const sleepTimerIcon = document.createElement("yt-icon");
  pageCall(sleepTimerIcon, "set", "icon", "TIMER");
  sleepTimerButton.appendChild(sleepTimerIcon);

  sleepTimerButton.setAttribute("title", "Sleep timer off");
  sleepTimerButton.classList.add("ytmusic-player-bar");
  sleepTimerButton.classList.add("ytmd-player-bar-control");
  sleepTimerButton.classList.add("sleep-timer-button");
  sleepTimerButton.onclick = () => {
    sleepTimerButton.dispatchEvent(
      new CustomEvent("yt-action", {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-open-popup-action",
          args: [
            {
              openPopupAction: {
                popup: {
                  menuPopupRenderer: {
                    accessibilityData: {
                      label: "Action menu",
                    },
                    items: [
                      {
                        menuServiceItemRenderer: {
                          icon: {
                            iconType: "CLOCK",
                          },
                          serviceEndpoint: {
                            ytmdSleepTimerServiceEndpoint: {
                              time: 5,
                            },
                          },
                          text: {
                            runs: [
                              {
                                text: "5 minutes",
                              },
                            ],
                          },
                        },
                      },
                      {
                        menuServiceItemRenderer: {
                          icon: {
                            iconType: "CLOCK",
                          },
                          serviceEndpoint: {
                            ytmdSleepTimerServiceEndpoint: {
                              time: 10,
                            },
                          },
                          text: {
                            runs: [
                              {
                                text: "10 minutes",
                              },
                            ],
                          },
                        },
                      },
                      {
                        menuServiceItemRenderer: {
                          icon: {
                            iconType: "CLOCK",
                          },
                          serviceEndpoint: {
                            ytmdSleepTimerServiceEndpoint: {
                              time: 15,
                            },
                          },
                          text: {
                            runs: [
                              {
                                text: "15 minutes",
                              },
                            ],
                          },
                        },
                      },
                      {
                        menuServiceItemRenderer: {
                          icon: {
                            iconType: "CLOCK",
                          },
                          serviceEndpoint: {
                            ytmdSleepTimerServiceEndpoint: {
                              time: 30,
                            },
                          },
                          text: {
                            runs: [
                              {
                                text: "30 minutes",
                              },
                            ],
                          },
                        },
                      },
                      {
                        menuServiceItemRenderer: {
                          icon: {
                            iconType: "CLOCK",
                          },
                          serviceEndpoint: {
                            ytmdSleepTimerServiceEndpoint: {
                              time: 45,
                            },
                          },
                          text: {
                            runs: [
                              {
                                text: "45 minutes",
                              },
                            ],
                          },
                        },
                      },
                      {
                        menuServiceItemRenderer: {
                          icon: {
                            iconType: "CLOCK",
                          },
                          serviceEndpoint: {
                            ytmdSleepTimerServiceEndpoint: {
                              time: 60,
                            },
                          },
                          text: {
                            runs: [
                              {
                                text: "1 hour",
                              },
                            ],
                          },
                        },
                      },
                      sleepTimerTimeout !== null
                        ? {
                            menuServiceItemRenderer: {
                              icon: {
                                iconType: "DELETE",
                              },
                              serviceEndpoint: {
                                ytmdSleepTimerServiceEndpoint: {
                                  time: 0,
                                },
                              },
                              text: {
                                runs: [
                                  {
                                    text: "Clear sleep timer",
                                  },
                                ],
                              },
                            },
                          }
                        : {},
                    ],
                  },
                },
                popupType: "DROPDOWN",
              },
            },
            sleepTimerButton,
          ],
          optionalAction: false,
          returnValue: [],
        },
      })
    );
  };
  const shuffleButton = rightControls ? rightControls.querySelector(".shuffle") : null;
  if (shuffleButton) shuffleButton.insertAdjacentElement("afterend", sleepTimerButton);
  else miss(rightControls ? ".right-controls-buttons .shuffle" : ".right-controls-buttons");

  const humanizeTime = (time: number) => {
    if (time === 1) return `${time} minute`;
    if (time > 1 && time < 60) return `${time} minutes`;
    if (time >= 60 && time < 120) return `${time / 60} hour`;
    if (time >= 120) return `${time / 60} hours`;
    return undefined;
  };

  window.addEventListener("yt-action", (e) => {
    const detail = pageRecord(pageMember(e, "detail"));
    if (detail?.actionName === "yt-service-request") {
      const endpoint = pageRecord(pageMember(detail.args, 1, "ytmdSleepTimerServiceEndpoint"));
      if (endpoint && typeof endpoint.time === "number") {
        if (sleepTimerTimeout !== null) {
          clearTimeout(sleepTimerTimeout);
          sleepTimerTimeout = null;
          if (sleepTimerButton.hasAttribute("aria-pressed")) {
            sleepTimerButton.removeAttribute("aria-pressed");
            sleepTimerButton.setAttribute("title", "Sleep timer off");
          }
        }

        if (endpoint.time > 0) {
          if (!sleepTimerButton.hasAttribute("aria-pressed")) {
            sleepTimerButton.setAttribute("aria-pressed", "true");
            sleepTimerButton.setAttribute("title", `Sleep timer ${humanizeTime(endpoint.time)}`);
          }

          document.body.dispatchEvent(
            new CustomEvent("yt-action", {
              bubbles: true,
              cancelable: false,
              composed: true,
              detail: {
                actionName: "yt-open-popup-action",
                args: [
                  {
                    openPopupAction: {
                      popup: {
                        notificationActionRenderer: {
                          responseText: {
                            runs: [
                              {
                                text: `Sleep timer set to ${humanizeTime(endpoint.time)}`,
                              },
                            ],
                          },
                        },
                      },
                      popupType: "TOAST",
                      uniqueId: crypto.randomUUID(),
                    },
                  },
                  document.querySelector("ytmusic-app"),
                ],
                optionalAction: false,
                returnValue: [],
              },
            })
          );

          sleepTimerTimeout = setTimeout(
            () => {
              sleepTimerTimeout = null;
              sleepTimerButton.removeAttribute("aria-pressed");
              sleepTimerButton.setAttribute("title", "Sleep timer off");

              const sleepPlayerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
              if (pageMember(sleepPlayerBar, "playing")) {
                pageCall(window, "__ytmdPause", pageMember(sleepPlayerBar, "playerApi"));

                document.body.dispatchEvent(
                  new CustomEvent("yt-action", {
                    bubbles: true,
                    cancelable: false,
                    composed: true,
                    detail: {
                      actionName: "yt-open-popup-action",
                      args: [
                        {
                          openPopupAction: {
                            popup: {
                              dismissableDialogRenderer: {
                                title: {
                                  runs: [
                                    {
                                      text: "Music paused",
                                    },
                                  ],
                                },
                                dialogMessages: [
                                  {
                                    runs: [
                                      {
                                        text: "Sleep timer expired and your music has been paused",
                                      },
                                    ],
                                  },
                                ],
                              },
                            },
                            popupType: "DIALOG",
                          },
                        },
                        document.querySelector("ytmusic-app"),
                      ],
                      optionalAction: false,
                      returnValue: [],
                    },
                  })
                );
              }
            },
            endpoint.time * 1000 * 60
          );
        } else {
          document.body.dispatchEvent(
            new CustomEvent("yt-action", {
              bubbles: true,
              cancelable: false,
              composed: true,
              detail: {
                actionName: "yt-open-popup-action",
                args: [
                  {
                    openPopupAction: {
                      popup: {
                        notificationActionRenderer: {
                          responseText: {
                            runs: [
                              {
                                text: `Sleep timer cleared`,
                              },
                            ],
                          },
                        },
                      },
                      popupType: "TOAST",
                      uniqueId: crypto.randomUUID(),
                    },
                  },
                  document.querySelector("ytmusic-app"),
                ],
                optionalAction: false,
                returnValue: [],
              },
            })
          );
        }
      }
    }
  });
}
