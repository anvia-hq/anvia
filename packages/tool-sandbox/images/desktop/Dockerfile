# A reference image for a remote sandbox with a desktop: a virtual display an agent can see and
# drive and a person can take over, plus Chromium, tmux, and the Anvia daemon.
#
#   docker build -t my-desktop-sandbox packages/tool-sandbox/images/desktop
#   docker run --rm -e ANVIA_CONTROL_URL=wss://hub.example.com/daemon \
#     -e ANVIA_SANDBOX_TOKEN=... my-desktop-sandbox
#
# The daemon dials out to your hub, so nothing needs to be published. Nothing graphical runs until
# the desktop is first used. To build against a local package instead of the published one:
#   npm pack && docker build --build-arg ANVIA_SANDBOX_PACKAGE=/ctx/anvia-sandbox-*.tgz \
#     -f images/desktop/Dockerfile .   (with the tarball in the build context)
FROM node:22-bookworm

ARG ANVIA_SANDBOX_PACKAGE=@anvia/sandbox
ARG NODE_PTY_VERSION=^1.1.0

# Xvfb, openbox, x11vnc: the display, a light window manager, and the VNC server (loopback only).
# picom and plank: a compositor and a dock, started by openbox's autostart file. lxterminal and
# pcmanfm: the dock's terminal and file manager.
# xdotool and ImageMagick: the agent's input and screenshots. xrandr: resizing. tmux and node-pty
# (below): terminals that survive reconnects. The node base image already carries the compilers
# node-pty builds with on Linux.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    xvfb openbox plank picom dbus-x11 x11vnc lxterminal pcmanfm feh yaru-theme-gtk yaru-theme-icon fonts-inter xdotool imagemagick x11-utils x11-xserver-utils \
    fonts-dejavu-core fonts-liberation fonts-noto-color-emoji \
    chromium tmux procps ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# `--mount` lets ANVIA_SANDBOX_PACKAGE point at a tarball in the build context (as /ctx/...).
RUN --mount=type=bind,target=/ctx \
  npm install -g "${ANVIA_SANDBOX_PACKAGE}" "node-pty@${NODE_PTY_VERSION}" \
  && npm cache clean --force
ENV NODE_PATH=/usr/local/lib/node_modules

COPY anvia-chromium /usr/local/bin/anvia-chromium
RUN chmod 0555 /usr/local/bin/anvia-chromium \
  && install -d -o node -g node /workspace
COPY anvia-terminal.desktop /usr/share/applications/anvia-terminal.desktop
COPY --chown=node:node plank/ /home/node/.config/plank/
COPY --chown=node:node glib/keyfile /home/node/.config/glib-2.0/settings/keyfile
COPY --chown=node:node openbox/autostart /home/node/.config/openbox/autostart
COPY --chown=node:node gtk/settings.ini /home/node/.config/gtk-3.0/settings.ini
COPY --chown=node:node gtk/gtkrc-2.0 /home/node/.gtkrc-2.0
COPY --chown=node:node lxterminal/lxterminal.conf /home/node/.config/lxterminal/lxterminal.conf

# The look: Yaru (Ubuntu's theme) for GTK apps and icons, the dark Onyx frames for openbox windows,
# Inter, and a wallpaper drawn here so the image carries no binary asset. Openbox reads its theme
# name from rc.xml, so start from the system one and change just that.
RUN install -d -o node -g node /home/node/.config/openbox /usr/share/anvia \
  && sed -E '0,/<name>[^<]*<\/name>/s//<name>Onyx<\/name>/' /etc/xdg/openbox/rc.xml \
    > /home/node/.config/openbox/rc.xml \
  && chown node:node /home/node/.config/openbox/rc.xml \
  && convert -size 1920x1200 gradient:'#3b4b63-#14181f' /usr/share/anvia/wallpaper.png

USER node
WORKDIR /workspace
ENV ANVIA_SANDBOX_WORKDIR=/workspace \
    ANVIA_SANDBOX_STATE_DIR=/home/node/.anvia-sandbox

# Required at run time: ANVIA_CONTROL_URL and ANVIA_SANDBOX_TOKEN.
CMD ["anvia-sandbox-daemon"]
