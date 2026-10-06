import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spotifyUri } from '../src/shared/spotify.js';
import { Spotify, parseState } from '../src/server/spotify.js';

const ID = '4bZd0nRuX8HyjeXAUBczvm';

test('a link from Spotify’s Share menu becomes its spotify: URI', () => {
  assert.deepEqual(spotifyUri(`https://open.spotify.com/track/${ID}?si=abc123`), { uri: `spotify:track:${ID}` });
  assert.deepEqual(spotifyUri(`https://open.spotify.com/intl-sk/album/${ID}`), { uri: `spotify:album:${ID}` });
  assert.deepEqual(spotifyUri(` spotify:playlist:${ID} `), { uri: `spotify:playlist:${ID}` });
});

test('anything else is turned away before it reaches AppleScript', () => {
  for (const bad of ['', 'not a link', `https://example.com/track/${ID}`, `https://open.spotify.com/user/${ID}`, 'https://open.spotify.com/track/short', `spotify:track:${ID}" & do shell script "x`, `spotify:track:${ID}:extra`]) {
    assert.ok('error' in spotifyUri(bad), bad);
  }
});

test('what the app reports is read field by field', () => {
  assert.deepEqual(parseState('stopped'), { playing: false });
  assert.deepEqual(parseState(`playing\tSong\tBand\tspotify:track:${ID}`), { playing: true, title: 'Song', artist: 'Band', uri: `spotify:track:${ID}` });
  assert.deepEqual(parseState(`paused\tSong\t\t`), { playing: false, title: 'Song' });
});

test('a command runs its script, then reports what is on', async () => {
  const ran: string[] = [];
  const sp = new Spotify(async (s) => (ran.push(s), s.includes('player state') ? `playing\tSong\tBand\tspotify:track:${ID}` : ''), true, 0);
  assert.deepEqual(await sp.command({ do: 'play', uri: `spotify:track:${ID}` }), { state: { playing: true, title: 'Song', artist: 'Band', uri: `spotify:track:${ID}` } });
  assert.equal(ran[0], `tell application "Spotify" to play track "spotify:track:${ID}"`);
  await sp.command({ do: 'next' });
  assert.equal(ran[2], 'tell application "Spotify" to next track');
});

test('a script that fails is an error to show, and a failed look is silence', async () => {
  const sp = new Spotify(async () => {
    throw new Error('Spotify got an error');
  }, true, 0);
  assert.deepEqual(await sp.command({ do: 'pause' }), { error: 'Spotify didn’t do it: Spotify got an error' });
  assert.deepEqual(await sp.state(), { playing: false });
});
