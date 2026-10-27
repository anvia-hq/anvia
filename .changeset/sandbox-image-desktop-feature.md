---
"@anvia/sandbox": patch
---

`anvia-sandbox create-image` has a `desktop` feature (`--feature desktop`). It generates a Debian image with `Xvnc`, `openbox`, `xdotool`, ImageMagick, tmux and the Anvia daemon, running as a non-root user, for the remote runtime. Add your own programs with `--apt`. Before, a custom desktop image meant adapting the reference Dockerfile by hand.
