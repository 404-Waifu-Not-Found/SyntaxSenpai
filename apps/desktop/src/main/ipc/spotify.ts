/**
 * Spotify IPC – gives the AI access to the currently playing track.
 *
 * Uses AppleScript on macOS to query the Spotify desktop app directly.
 * No API keys or OAuth required — talks to the running Spotify process.
 */

const { ipcMain } = require('electron')
const { exec } = require('child_process')

let registered = false

function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      `osascript -e '${script.replace(/'/g, "'\\''")}'`,
      { timeout: 5000 },
      (error: any, stdout: string, stderr: string) => {
        if (error) reject(new Error(stderr || error.message))
        else resolve(stdout.trim())
      },
    )
  })
}

export function registerSpotifyIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('spotify:nowPlaying', async () => {
    try {
      // Check if Spotify is running
      const running = await runAppleScript(
        'tell application "System Events" to (name of processes) contains "Spotify"',
      )
      if (running !== 'true') {
        return { success: false, error: 'Spotify is not running.' }
      }

      // Check player state
      const state = await runAppleScript(
        'tell application "Spotify" to player state as string',
      )

      if (state === 'stopped') {
        return { success: false, error: 'Spotify is not playing anything right now.' }
      }

      // Get track info in parallel
      const [track, artist, album, duration, position, artworkUrl] = await Promise.all([
        runAppleScript('tell application "Spotify" to name of current track'),
        runAppleScript('tell application "Spotify" to artist of current track'),
        runAppleScript('tell application "Spotify" to album of current track'),
        runAppleScript('tell application "Spotify" to duration of current track'),
        runAppleScript('tell application "Spotify" to player position'),
        runAppleScript('tell application "Spotify" to artwork url of current track').catch(() => ''),
      ])

      const durationSec = Math.round(Number(duration) / 1000)
      const positionSec = Math.round(Number(position))
      const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

      return {
        success: true,
        data: {
          track,
          artist,
          album,
          state,
          position: formatTime(positionSec),
          duration: formatTime(durationSec),
          artworkUrl: artworkUrl || null,
        },
      }
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  ipcMain.handle('spotify:control', async (_event: any, action: string) => {
    try {
      const running = await runAppleScript(
        'tell application "System Events" to (name of processes) contains "Spotify"',
      )
      if (running !== 'true') {
        return { success: false, error: 'Spotify is not running.' }
      }

      switch (action) {
        case 'play':
          await runAppleScript('tell application "Spotify" to play')
          break
        case 'pause':
          await runAppleScript('tell application "Spotify" to pause')
          break
        case 'next':
          await runAppleScript('tell application "Spotify" to next track')
          break
        case 'previous':
          await runAppleScript('tell application "Spotify" to previous track')
          break
        case 'play_pause':
          await runAppleScript('tell application "Spotify" to playpause')
          break
        default:
          return { success: false, error: `Unknown action: ${action}` }
      }

      return { success: true }
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })
}

module.exports = { registerSpotifyIpc }

export {}
