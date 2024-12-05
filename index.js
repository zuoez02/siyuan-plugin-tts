const { Plugin, Menu } = require("siyuan");

const OUTPUT_FORMAT = {
  RAW_16KHZ_16BIT_MONO_PCM: "raw-16khz-16bit-mono-pcm",
  RAW_24KHZ_16BIT_MONO_PCM: "raw-24khz-16bit-mono-pcm",
  RAW_48KHZ_16BIT_MONO_PCM: "raw-48khz-16bit-mono-pcm",
  RAW_8KHZ_8BIT_MONO_MULAW: "raw-8khz-8bit-mono-mulaw",
  RAW_8KHZ_8BIT_MONO_ALAW: "raw-8khz-8bit-mono-alaw",
  RAW_16KHZ_16BIT_MONO_TRUESILK: "raw-16khz-16bit-mono-truesilk",
  RAW_24KHZ_16BIT_MONO_TRUESILK: "raw-24khz-16bit-mono-truesilk",
  RIFF_16KHZ_16BIT_MONO_PCM: "riff-16khz-16bit-mono-pcm",
  RIFF_24KHZ_16BIT_MONO_PCM: "riff-24khz-16bit-mono-pcm",
  RIFF_48KHZ_16BIT_MONO_PCM: "riff-48khz-16bit-mono-pcm",
  RIFF_8KHZ_8BIT_MONO_MULAW: "riff-8khz-8bit-mono-mulaw",
  RIFF_8KHZ_8BIT_MONO_ALAW: "riff-8khz-8bit-mono-alaw",
  AUDIO_16KHZ_32KBITRATE_MONO_MP3: "audio-16khz-32kbitrate-mono-mp3",
  AUDIO_16KHZ_64KBITRATE_MONO_MP3: "audio-16khz-64kbitrate-mono-mp3",
  AUDIO_16KHZ_128KBITRATE_MONO_MP3: "audio-16khz-128kbitrate-mono-mp3",
  AUDIO_24KHZ_48KBITRATE_MONO_MP3: "audio-24khz-48kbitrate-mono-mp3",
  AUDIO_24KHZ_96KBITRATE_MONO_MP3: "audio-24khz-96kbitrate-mono-mp3",
  AUDIO_24KHZ_160KBITRATE_MONO_MP3: "audio-24khz-160kbitrate-mono-mp3",
  AUDIO_48KHZ_96KBITRATE_MONO_MP3: "audio-48khz-96kbitrate-mono-mp3",
  AUDIO_48KHZ_192KBITRATE_MONO_MP3: "audio-48khz-192kbitrate-mono-mp3",
  WEBM_16KHZ_16BIT_MONO_OPUS: "webm-16khz-16bit-mono-opus",
  WEBM_24KHZ_16BIT_MONO_OPUS: "webm-24khz-16bit-mono-opus",
  OGG_16KHZ_16BIT_MONO_OPUS: "ogg-16khz-16bit-mono-opus",
  OGG_24KHZ_16BIT_MONO_OPUS: "ogg-24khz-16bit-mono-opus",
  OGG_48KHZ_16BIT_MONO_OPUS: "ogg-48khz-16bit-mono-opus",
};

const { randomBytes } = window.require("crypto");
const stream = window.require("stream");

class MsEdgeTTS {
  static OUTPUT_FORMAT = OUTPUT_FORMAT;
  static TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
  static VOICES_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${MsEdgeTTS.TRUSTED_CLIENT_TOKEN}`;
  static SYNTH_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${MsEdgeTTS.TRUSTED_CLIENT_TOKEN}`;
  static BINARY_DELIM = "Path:audio\r\n";
  static VOICE_LANG_REGEX = /\w{2}-\w{2}/;
  _enableLogger;
  _ws;
  _connection;
  _voice;
  _voiceLocale;
  _outputFormat;
  _queue = {};
  _startTime = 0;
  _end = {};
  _requestContent = {};
  _finished = {};

  /**
   * Create a new `MsEdgeTTS` instance.
   *
   * @param enableLogger=false whether to enable the built-in logger. This logs connections inits, disconnects, and incoming data to the console
   */
  constructor(enableLogger = false) {
    this._enableLogger = enableLogger;
  }

  async _send(message) {
    await this._initClient();
    return this._ws.send(message);
  }

  // _connect() {
  //     if (this._enableLogger) this._startTime = Date.now();
  //     this._ws.connect(MsEdgeTTS.SYNTH_URL);
  //     return new Promise((resolve) => this._ws.once("connect", resolve));
  // }

  close() {
    this._ws && this._ws.close();
  }

  _initClient() {
    if (this.wsInitPromise) {
      return this.wsInitPromise;
    }
    this.wsInitPromise = new Promise((resolve, reject) => {
      const messageQueue = [];

      const checkAndSend = (id, index) => {
        this._enableLogger && console.log("[TTS]\tchecking", id, index);
        const cache = [];
        if (!this._end[id]) {
          return;
        }
        let j = 0;
        for (; j <= index; j++) {
          if (!messageQueue[j]) {
            this._enableLogger && console.log("[TTS]\tCheck found null", id, j);
            return false;
          }
          if (messageQueue[j].id !== id) {
            continue;
          }
          if (messageQueue[j].data) {
            cache.push(messageQueue[j].data);
          }
        }
        for (const audio of cache) {
          this._queue[id].push(audio);
        }
        this._enableLogger &&
          console.log(
            "[TTS]\tCheck finished",
            id,
            index,
            j,
            this._requestContent[id]
          );
        this._queue[id].push(null);
        this._finished[id] = true;
        return true;
      };
      const checkEndedNotFinished = () => {
        for (const k in this._end) {
          if (!this._finished[k]) {
            this._enableLogger &&
              console.log(
                "[TTS]\tChecking ended request but not finished",
                k,
                this._end[k],
                this._requestContent[k]
              );
            checkAndSend(k, this._end[k]);
          }
        }
      };
      let i = 0;
      this._ws = new WebSocket(MsEdgeTTS.SYNTH_URL);
      this._ws.onmessage = (m) => {
        if (typeof m.data === "string") {
          // const data = m.data;
          const data = Buffer.from(m.data);
          const res = /X-RequestId:(.*?)\r\n/gm.exec(data);
          const requestId = res[1];
          if (data.includes("Path:turn.start")) {
            // start of turn, ignore
            messageQueue[i] = { id: requestId, type: "start" };
          } else if (data.includes("Path:turn.end")) {
            // end of turn, close stream
            this._end[requestId] = i;
            messageQueue[i] = { id: requestId, type: "end" };
            this._enableLogger &&
              console.log(
                "[TTS]\tEnd: ",
                this._requestContent[requestId],
                requestId
              );
          } else if (data.includes("Path:response")) {
            // context response, ignore
            messageQueue[i] = { id: requestId, type: "ignore" };
          } else {
            this.enableLogger && console.log("UNKNOWN MESSAGE", data);
          }
          this._enableLogger &&
            console.log(
              "[TTS]\tString set: ",
              i,
              messageQueue[i],
              requestId,
              this._requestContent[requestId]
            );
          checkAndSend(requestId, i);
        } else if (m.data instanceof Blob) {
          const blob = m.data;
          let cur = i;
          messageQueue[i] = null;
          blob.arrayBuffer().then((buffer) => {
            const data = new Buffer(buffer);
            const res = /X-RequestId:(.*?)\r\n/gm.exec(data);
            const requestId = res[1];
            if (data[0] === 0x00 && data[1] === 0x67 && data[2] === 0x58) {
              // ignore
              messageQueue[cur] = { id: requestId, type: "ignore" };
            } else {
              const index =
                data.indexOf(MsEdgeTTS.BINARY_DELIM) +
                MsEdgeTTS.BINARY_DELIM.length;
              const audioData = data.slice(index, data.length);
              messageQueue[cur] = { id: requestId, data: audioData };
            }
            this._enableLogger &&
              console.log("[TTS]\tblob set:", cur, messageQueue[cur]);
            checkAndSend(requestId, this._end[requestId] || -1);
            checkEndedNotFinished();
          });
        } else {
          this._enableLogger && console.warn("[TTS]\t UNKNOWN type of m.data");
        }
        i++;
      };
      this._ws.onclose = () => {
        this._enableLogger && console.log("[TTS]\tdisconnected");
        this.wsInitPromise = null;
      };
      this._ws.onopen = (connection) => {
        this._connection = connection;
        this._enableLogger &&
          console.log(
            "[TTS]\tConnected in",
            (Date.now() - this._startTime) / 1000,
            "seconds"
          );

        this._ws
          .send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n
                    {
                        "context": {
                            "synthesis": {
                                "audio": {
                                    "metadataoptions": {
                                        "sentenceBoundaryEnabled": "false",
                                        "wordBoundaryEnabled": "false"
                                    },
                                    "outputFormat": "${this._outputFormat}" 
                                }
                            }
                        }
                    }
                `);
        resolve(this._ws);
      };

      this._ws.onerror = function (error) {
        reject("Connect Error: " + error);
      };
    });
    return this.wsInitPromise;
  }

  _SSMLTemplate(input) {
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${this._voiceLocale}">
                <voice name="${this._voice}">
                    ${input}
                </voice>
            </speak>`;
  }

  /**
   * Fetch the list of voices available in Microsoft Edge.
   * These, however, are not all. The complete list of voices supported by this module [can be found here](https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/language-support) (neural, standard, and preview).
   */
  getVoices() {
    return new Promise((resolve, reject) => {
      fetch(MsEdgeTTS.VOICES_URL, { method: "GET" })
        .then((res) => resolve(res.data))
        .catch(reject);
    });
  }

  /**
   * Sets the required information for the speech to be synthesised and inits a new WebSocket connection.
   * Must be called at least once before text can be synthesised.
   * Saved in this instance. Can be called at any time times to update the metadata.
   *
   * @param voiceName a string with any `ShortName`. A list of all available neural voices can be found [here](https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/language-support#neural-voices). However, it is not limited to neural voices: standard voices can also be used. A list of standard voices can be found [here](https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/language-support#standard-voices)
   * @param outputFormat any {@link OUTPUT_FORMAT}
   * @param voiceLocale (optional) any voice locale that is supported by the voice. See the list of all voices for compatibility. If not provided, the locale will be inferred from the `voiceName`
   */
  async setMetadata(voiceName, outputFormat, voiceLocale) {
    const oldVoice = this._voice;
    const oldVoiceLocale = this._voiceLocale;
    const oldOutputFormat = this._outputFormat;

    this._voice = voiceName;
    this._voiceLocale = voiceLocale;
    if (!this._voiceLocale) {
      const voiceLangMatch = MsEdgeTTS.VOICE_LANG_REGEX.exec(this._voice);
      if (!voiceLangMatch)
        throw new Error("Could not infer voiceLocale from voiceName!");
      this._voiceLocale = voiceLangMatch[0];
    }
    this._outputFormat = outputFormat;

    const changed =
      oldVoice !== this._voice ||
      oldVoiceLocale !== this._voiceLocale ||
      oldOutputFormat !== this._outputFormat;

    // create new client
    if (!this._ws || changed) {
      await this._initClient();
    }
  }

  _metadataCheck() {
    if (!this._ws)
      throw new Error(
        "Speech synthesis not configured yet. Run setMetadata before calling toStream or toFile."
      );
  }

  /**
   * Writes raw audio synthesised from text in real-time to a {@link stream.Readable}. Uses a basic {@link _SSMLTemplate SML template}.
   *
   * @param input the text to synthesise. Can include SSML elements.
   */
  toStream(input) {
    return this._rawSSMLRequest(this._SSMLTemplate(input));
  }

  /**
   * Writes raw audio synthesised from a request in real-time to a {@link stream.Readable}. Has no SSML template. Basic SSML should be provided in the request.
   *
   * @param requestSSML the SSML to send. SSML elements required in order to work.
   */
  rawToStream(requestSSML) {
    return this._rawSSMLRequest(requestSSML);
  }

  async _rawSSMLRequest(requestSSML) {
    this._metadataCheck();
    if (!this._ws || this._ws.readyState === 2 || this._ws.readyState === 3) {
      await this._initClient();
    }

    const requestId = randomBytes(16).toString("hex");
    const request =
      `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n
                ` + requestSSML.trim();
    // https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/speech-synthesis-markup
    const readable = new stream.Readable({
      read() {},
    });
    this._requestContent[requestId] = requestSSML.trim().split("\n")[2].trim();
    this._queue[requestId] = readable;
    this._send(request).then();
    return readable;
  }
}

const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";

function toArrayBuffer(buf) {
  const ab = new ArrayBuffer(buf.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buf.length; ++i) {
    view[i] = buf[i];
  }
  return ab;
}

class Player {
  status; // 0: stop; 1: playing;
  content;
  loaded;
  loading;
  source;
  id;
  isEmpty = true;

  loadPromise;

  constructor(tts, controller, enableLogger) {
    this.enableLogger = enableLogger;
    this.controller = controller;
    this.status = 0;
    this.loaded = false;
    this.loading = false;
    this.tts = tts;
    this.id = new Date().getTime();
  }

  async load(block) {
    this.isEmpty = block.isEmpty();
    if (this.isEmpty) {
      this.loadPromise = Promise.resolve();
      return this.loadPromise;
    }
    this.block = block;
    this.content = block.content;
    if (this.loadPromise) {
      return this.loadPromise;
    }
    this.enableLogger &&
      console.log(`[Player]\tloading block: '${this.content}'`);
    const context = new AudioContext();
    const buffers = [];
    this.loading = true;
    this.loadPromise = this.tts.toStream(this.content).then((readable) => {
      return new Promise(async (resolve, reject) => {
        readable.on("data", (data) => {
          buffers.push(data);
        });

        readable.on("close", () => {
          const b = Buffer.concat(buffers);
          try {
            context.decodeAudioData(
              toArrayBuffer(b),
              (buffer) => {
                const source = context.createBufferSource();
                this.source = source;
                this.loaded = true;
                this.loading = false;
                source.buffer = buffer;
                source.connect(context.destination);
                resolve();
              },
              (e) => {
                reject(e);
              }
            );
          } catch (e) {
            reject(e);
          }
        });
      });
    });
    return this.loadPromise;
  }

  async setRate(rate) {
    if (!this.loaded) {
      await this.load(this.block);
    }
    if (this.isEmpty) {
      return Promise.resolve();
    }
    console.log(this.source);
    this.source.playbackRate.value = rate;
  }

  async play() {
    if (!this.loaded) {
      await this.load(this.block);
    }
    if (this.isEmpty) {
      return Promise.resolve();
    }
    this.block.highlight();
    this.source.start(0);
    return new Promise((resolve) => {
      this.source.addEventListener("ended", () => {
        this.block.unhighlight();
        resolve();
      });
    });
  }

  stop() {
    this.source && this.source.stop();
  }

  pause() {
    if (this.source && this.source.context) {
      this.source.context.suspend();
    }
  }

  resume() {
    if (this.source && this.source.context) {
      this.source.context.resume();
    }
  }
}

class Block {
  constructor(blockElement) {
    if (!blockElement) {
      throw Error("Block constructor must has 1 parameter blockElement");
    }
    this.el = blockElement;
    this.content = blockElement.textContent
      .normalize("NFD")
      .replace(/[\u200B-\u200D\uFEFF]/g, "");
  }

  isEmpty() {
    return this.content.trim() === "";
  }

  highlight() {
    this.el.setAttribute(
      "style",
      "border: 1px solid var(--tts-plugin-hightlight)"
    );
    // 用queryselector查找el，先获取el的data-node-id，然后再用queryselector找到对应的元素
    const nodeId = this.el.getAttribute("data-node-id");
    let el2 = document.querySelector(`.protyle-wysiwyg [data-node-id="${nodeId}"]`);
    el2.setAttribute(
      "style",
      "border: 1px solid var(--tts-plugin-hightlight)"
    );
  }

  unhighlight() {
    this.el.setAttribute("style", "border: none");
    // 用queryselector查找el，先获取el的data-node-id，然后再用queryselector找到对应的元素
    const nodeId = this.el.getAttribute("data-node-id");
    let el2 = document.querySelector(`.protyle-wysiwyg [data-node-id="${nodeId}"]`);
    el2.setAttribute(
      "style",
      "border: none"
    );
  }
}

class Controller {
  blocks;
  players;
  cache;
  status;
  playIndex;
  cacheIndex;

  constructor(config, plugin, enableLogger) {
    this.enableLogger = enableLogger;
    this.plugin = plugin;
    this.init();
    this.maxCache = 3;
    this.tts = new MsEdgeTTS(false);
    const { currentMetadata, playbackRate } = config;
    this.playbackRate = playbackRate;
    this.tts.setMetadata(currentMetadata, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
  }

  changeMetadata(voice) {
    this.tts.setMetadata(voice, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
  }

  loadBlocks(blockElements) {
    this.blocks = blockElements.map((v) => new Block(v));
  }

  async play() {
    this.enableLogger &&
      console.log(
        "[Controller]\tgoing to play, checking cache",
        this.playIndex,
        this.blocks
      );
    this.plugin.setStatus(`正在加载块, 数量: ${this.blocks.length}`);
    while (
      this.players.length < this.maxCache &&
      this.cacheIndex < this.blocks.length
    ) {
      if (this.blocks[this.cacheIndex].isEmpty()) {
        this.enableLogger && console.log("[Controller]\tskip empty block");
        this.cacheIndex++;
        continue;
      }
      const player = new Player(this.tts, this, false);
      player.load(this.blocks[this.cacheIndex]);
      this.enableLogger &&
        console.log("[Controller]\tCreate player cache", "id=", player.id);
      this.plugin.setStatus(`正在缓存块, 编号: ${this.cacheIndex + 1}`);
      this.players.push(player);
      this.cacheIndex++;
    }
    this.enableLogger &&
      console.log(
        "[Controller]\tcheck finished, ready to play",
        this.playIndex
      );
    const player = this.players[0];
    if (!player) {
      this.stop();
      this.enableLogger &&
        console.log(
          "[Controller]\tNo player in cache, going to clean and stop",
          this.playIndex
        );
      this.plugin.setStatus("播放完成, 已停止");
      return;
    }

    // Update play icon to pause icon when starting playback
    const iconEl = document.querySelector('.tts-nav-btn use');
    if (iconEl) {
      iconEl.setAttribute('xlink:href', '#iconPause');
    }

    this.enableLogger &&
      console.log(
        "[Controller]\tplaying =>>> ",
        player.content,
        this.playIndex
      );
    this.plugin.setStatus(
      `正在播放块, 编号: ${this.playIndex + 1}; 剩余未播放缓存: ${
        this.players.length
      }`
    );
    await player.setRate(this.playbackRate);
    await player.play();
    this.enableLogger &&
      console.log("[Controller]\tplayed =>>>", player.content, this.playIndex);
    this.players.shift();
    this.playIndex++;
    this.play();
  }

  stop() {
    this.players.forEach((p) => {
      try {
        p.stop();
      } catch {
        return;
      }
    });
    this.tts.close();
    const block = this.blocks[this.playIndex];
    if (block) {
      block.unhighlight();
    }
    // Reset icon back to record when stopped
    const iconEl = document.querySelector('.tts-nav-btn use');
    if (iconEl) {
      iconEl.setAttribute('xlink:href', '#iconRecord'); 
    }
    this.init();
  }

  init() {
    this.blocks = [];
    this.players = [];
    this.index = 0;
    this.cacheIndex = 0;
    this.playIndex = 0;
  }

  pause() {
    if (this.players && this.players[0]) {
      this.players[0].pause();
      this.isPaused = true;
    }
  }

  resume() {
    if (this.players && this.players[0]) {
      this.players[0].resume();
      this.isPaused = false;
    }
  }
}

module.exports = class TTSPlugin extends Plugin {
  metadataMap = {
    '晓晓-中文女声': 'zh-CN-XiaoxiaoNeural',
    '云曦-中文男声': 'zh-CN-YunxiNeural',
    '云阳-中文男声': 'zh-CN-YunyangNeural',
    'Connor-英文男声': 'en-IE-ConnorNeural',
  }

  untestedMetadata = [];

  currentMetadata = DEFAULT_VOICE;

  playbackRate = 1;

  async loadStorage() {
    const config = await this.loadData('config.json');
    if (config) {
        this.currentMetadata = config.currentMetadata || DEFAULT_VOICE;
        this.playbackRate = config.playbackRate || 1;
    }
  }

  async saveStorage() {
    await this.saveData('config.json', JSON.stringify({
      currentMetadata: this.currentMetadata,
      playbackRate: this.playbackRate,
    }));
  }

  onload() {
    this.loadStorage();
    this.controller = null;

    this.status = this.i18n.title;

    const topBarElement = this.addTopBar({
      icon: "iconRecord",
      title: this.i18n.title,
      position: "right",
      callback: () => {
        let rect = topBarElement.getBoundingClientRect();
        if (rect.width === 0) {
          rect = document.querySelector("#barMore").getBoundingClientRect();
        }
        this.addMenu(rect);
      },
    });

    this.eventBus.on("click-blockicon", ({ detail }) => {
      const blocks = detail.blockElements;
      detail.menu.addItem({
        icon: "iconRecord",
        label: this.i18n.menuName,
        click: async () => {
          if (this.controller) {
            this.controller.stop(); 
          }
          this.controller = new Controller({
            currentMetadata: this.currentMetadata,
            playbackRate: this.playbackRate
          }, this, false);
          this.controller.loadBlocks(blocks);
          this.controller.play();
        },
      });

      // Add new menu item for reading from current to end
      detail.menu.addItem({
        icon: "iconRecord", 
        label: this.i18n.menuToEnd,
        click: async () => {
          if (this.controller) {
            this.controller.stop();
          }

          // Get current block ID
          const currentBlockId = blocks[0].getAttribute('data-node-id');
          // Get root block ID (document ID)
          const rootID = detail.protyle.block.rootID
          
          // Get full document DOM
          let res = await this.fetchSyncPost("/api/block/getBlockDOM", { id: rootID });
          let dom = res.data.dom;
          let parser = new DOMParser();
          let doc = parser.parseFromString(dom, "text/html");
          
          // Filter blocks from current to end
          let allBlocks = [];
          let currentFound = false;
          doc.body.querySelectorAll('[data-node-id]').forEach(block => {
            if(block.getAttribute('data-node-id') === currentBlockId) {
              currentFound = true;
            }
            if(currentFound) {
              allBlocks.push(block);
            }
          });

          this.controller = new Controller({
            currentMetadata: this.currentMetadata,
            playbackRate: this.playbackRate
          }, this, false);
          this.controller.loadBlocks(allBlocks);
          this.controller.play();
        },
      });
    });
    
    this.eventBus.on("click-editortitleicon", async ({ detail }) => {
      detail.menu.addItem({
        icon: "iconRecord",
        label: this.i18n.menuName,
        click: async () => {
          const docID = detail.protyle.block.rootID;
          let res = await this.fetchSyncPost("/api/block/getBlockDOM", { id: docID });
          let dom = res.data.dom;
          let parser = new DOMParser();
          let doc = parser.parseFromString(dom, "text/html");
          let blocks = Array.from(doc.body.children);
          if (this.controller) {
            this.controller.stop();
          }
          this.controller = new Controller({
            currentMetadata: this.currentMetadata,
            playbackRate: this.playbackRate
          }, this, false);
          this.controller.loadBlocks(blocks);
          this.controller.play();
        },
      });
    });

    this.addStatus();
  }

  async  fetchSyncPost(url, data, returnType = 'json') {
    const init = {
      method: "POST",
    };
    if (data) {
      if (data instanceof FormData) {
        init.body = data;
      } else {
        init.body = JSON.stringify(data);
      }
    }
    try {
      const res = await fetch(url, init);
      const res2 = returnType === 'json' ? await res.json() : await res.text();
      return res2;
    } catch (e) {
      console.log(e);
      return returnType === 'json' ? { code: e.code || 1, msg: e.message || "", data: null } : "";
    }
}


  setStatus(content) {
    this.status = content;
    this.updateStatus(content);
  }

  addMenu(rect) {
    const menu = new Menu("ttsPluginTopBarMenu");
    
    menu.addItem({
      icon: "iconPause",
      label: this.isPaused ? this.i18n.resume : this.i18n.pause,
      click: () => {
        if (this.controller) {
          if (this.controller.isPaused) {
            this.controller.resume();
          } else {
            this.controller.pause();
          }
        }
      },
    });

    menu.addItem({
      icon: "iconClose", 
      label: this.i18n.stop,
      click: () => {
        this.controller && this.controller.stop();
      },
    });

    const sumMenus = Object.keys(this.metadataMap).map((v) => {
      return {
        icon: this.metadataMap[v] === this.currentMetadata ? 'iconSelect' : '',
        label: v,
        click: () => {
          this.currentMetadata = this.metadataMap[v];
          this.saveStorage();
        },
      };
    });

    menu.addItem({
      icon: "",
      label: this.i18n.changeMetadata,
      type: "submenu",
      submenu: sumMenus,
    });
    menu.open({
      x: rect.right,
      y: rect.bottom,
      isLeft: true,
    });

    const playRateMenus = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 3, 5, 10].map((v) => {
      return {
        icon: v === this.playbackRate ? 'iconSelect' : '',
        label: v,
        click: () => {
          this.playbackRate = v;
          this.saveStorage();
        },
      };
    });

    menu.addItem({
      icon: '',
      label: this.i18n.playbackRate,
      type: 'submenu',
      submenu: playRateMenus,
    })
  }

  addStatus() {
    this.statusIconTemp = document.createElement("template");
    this.statusIconTemp.innerHTML = `<div class="toolbar__item">
      <span class="tts-nav-btn" data-type="pause">
        <svg><use xlink:href="#iconRecord"></use></svg>
      </span>
      <span id="tts-content">${this.i18n.title}</span>
    </div>`;

    const element = this.statusIconTemp.content.firstElementChild;
    
    // Add click handlers for navigation buttons

    element.querySelector('[data-type="pause"]').addEventListener('click', () => {
      if (this.controller) {
        if (this.controller.isPaused) {
          this.controller.resume();
          element.querySelector('[data-type="pause"] use').setAttribute('xlink:href', '#iconPause');
        } else {
          this.controller.pause();
          element.querySelector('[data-type="pause"] use').setAttribute('xlink:href', '#iconPlay');
        }
      }
    });


    this.addStatusBar({
      element: element,
    });
    
    this.statusIconTemp = element.querySelector("#tts-content");
  }

  updateStatus(content) {
    this.statusIconTemp.textContent = content;
  }
};
