const { Plugin, Menu } = require('siyuan');

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
const stream = window.require('stream');

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
    _promises = {
        'undefined': Promise.resolve(),
    };

    /**
     * Create a new `MsEdgeTTS` instance.
     *
     * @param enableLogger=false whether to enable the built-in logger. This logs connections inits, disconnects, and incoming data to the console
     */
    constructor(enableLogger = false) {
        this._enableLogger = enableLogger;
    }

    async _send(message) {
        this._ws.send(message);
    }

    // _connect() {
    //     if (this._enableLogger) this._startTime = Date.now();
    //     this._ws.connect(MsEdgeTTS.SYNTH_URL);
    //     return new Promise((resolve) => this._ws.once("connect", resolve));
    // }

    _initClient() {
        this._ws = new WebSocket(MsEdgeTTS.SYNTH_URL);
        return new Promise((resolve, reject) => {
            this._ws.onmessage = async(m) => {
                if (typeof m.data === 'string') {
                    // const data = m.data;
                    const data = Buffer.from(m.data);
                    const res = /X-RequestId:(.*?)\r\n/gm.exec(data);
                    const requestId = res[1];
                    if (data.includes("Path:turn.start")) {
                        // start of turn, ignore
                    } else if (data.includes("Path:turn.end")) {
                        // end of turn, close stream
                        this._promises['undefined'] = this._promises['undefined'].then(() => {
                            this._queue[requestId].push(null);
                        });
                    } else if (data.includes("Path:response")) {
                        // context response, ignore
                    } else {
                        this.enableLogger && console.log("UNKNOWN MESSAGE", data);
                    }
                } else if (m.data instanceof Blob) {
                    const blob = m.data;
                    this._promises['undefined'] = this._promises['undefined'].then(async() => {
                        const buffer = await blob.arrayBuffer();
                        const data = new Buffer(buffer);
                        const res = /X-RequestId:(.*?)\r\n/gm.exec(data);
                        const requestId = res[1];
                        if (data[0] === 0x00 && data[1] === 0x67 && data[2] === 0x58) {
                            // Last (empty) audio fragment
                        } else {
                            const index = data.indexOf(MsEdgeTTS.BINARY_DELIM) + MsEdgeTTS.BINARY_DELIM.length;
                            const audioData = data.slice(index, data.length);
                            this._queue[requestId].push(audioData);
                        }
                    });
                }
            }
            this._ws.onclose = () => {
                this.enableLogger && console.log("disconnected");
            };
            this._ws.onopen = (connection) => {
                this._connection = connection;
                this.enableLogger && console.log("Connected in", (Date.now() - this._startTime) / 1000, "seconds");

                this._ws.send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n
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
                `)
                resolve();
            };

            this._ws.onerror = function(error) {
                reject("Connect Error: " + error);
            };

        });
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
            fetch(MsEdgeTTS.VOICES_URL, { method: 'GET' })
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
            if (!voiceLangMatch) throw new Error("Could not infer voiceLocale from voiceName!");
            this._voiceLocale = voiceLangMatch[0];
        }
        this._outputFormat = outputFormat;

        const changed = oldVoice !== this._voice ||
            oldVoiceLocale !== this._voiceLocale ||
            oldOutputFormat !== this._outputFormat;

        // create new client
        if (!this._ws || changed) {
            await this._initClient();
        }
    }

    _metadataCheck() {
        if (!this._ws) throw new Error(
            "Speech synthesis not configured yet. Run setMetadata before calling toStream or toFile.");
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


    _rawSSMLRequest(requestSSML) {
        this._metadataCheck();

        const requestId = randomBytes(16).toString("hex");
        const request = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n
                ` + requestSSML.trim();
        // https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/speech-synthesis-markup
        const readable = new stream.Readable({
            read() {},
        });
        this._queue[requestId] = readable;
        this._promises[requestId] = new Promise((resolve) => resolve);
        this._send(request).then();
        return readable;
    }

}

function toArrayBuffer(buf) {
    const ab = new ArrayBuffer(buf.length);
    const view = new Uint8Array(ab);
    for (let i = 0; i < buf.length; ++i) {
        view[i] = buf[i];
    }
    return ab;
}

class BufferPlayer {
    arrayBuffer;

    status = 0; // 0: not played; 1: playing; 2: ended

    constructor(buffer) {
        this.arrayBuffer = toArrayBuffer(buffer);
        this.context = new AudioContext();
        this.source = this.context.createBufferSource();
        this.status = 0;
    }

    decodeAudioData(ab) {
        return new Promise((resolve, reject) => {
            this.context.decodeAudioData(ab, (b) => resolve(b), (err) => reject(err));
        });
    }

    play() {
        return new Promise(async(resolve, reject) => {
            const b = await this.decodeAudioData(this.arrayBuffer);
            this.source.buffer = b;
            this.source.concat(this.context.destination);
            this.source.start(0);
            this.status = 1;

            this.source.addEventListener('ended', () => {
                if (this.status === 2) {
                    // stopped
                    reject('STOPPED');
                } else {
                    this.status = 2;
                    this.source = null;
                    resolve(null);
                }
            });
        })
    }

    stop() {
        this.source && this.source.stop();
        this.status = 2;
    }
}

class BufferPlayerController {
    players;
    current;
    playing;

    constructor() {
        this.players = [];
        this.current = 0;
    }

    append(player) {
        this.players.push(player);
    }

    start() {
        if (!this.playing) {
            this.current = 0;
            this.play();
            this.playing = true;
        }
    }

    async play() {
        console.log('current', this.current);
        const player = this.players[this.current];
        if (player === null) {
            // end
            return;
        }
        if (player === undefined) {
            // wait for next buffer
            await this.sleep(1000);
            this.play();
            return;
        }
        try {
            await player.play()
            this.current++;
            this.play();
        } catch {
            // stopped or else
            return;
        }
    }

    sleep(t) {
        return new Promise((resolve) => setTimeout(resolve, t));
    }

    stop() {
        const player = this.players[this.current];
        player.stop();
    }
}

module.exports = class TTSPlugin extends Plugin {
    current;
    onload() {
        const tts = new MsEdgeTTS();
        tts.setMetadata("zh-CN-XiaoxiaoNeural", OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
        // await tts.setMetadata("en-IE-ConnorNeural", OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);

        const topBarElement = this.addTopBar({
            icon: 'iconRecord',
            title: this.i18n.title,
            position: "right",
            callback: () => {
                let rect = topBarElement.getBoundingClientRect();
                if (rect.width === 0) {
                    rect = document.querySelector("#barMore").getBoundingClientRect();
                }
                this.addMenu(rect);

            }
        });

        const _this = this;
        this.eventBus.on("click-blockicon", ({ detail }) => {
            detail.menu.addItem({
                icon: 'iconRecord',
                label: this.i18n.menuName,
                click: () => {
                    if (_this.current) {
                        _this.current.stop();
                    }
                    const blocks = detail.blockElements;
                    const contents = blocks.map((v) => v.textContent).join('\n');
                    const readable = tts.toStream(contents);
                    const controller = new BufferPlayerController();
                    _this.current = controller;
                    let i = 0;
                    readable.on("data", (data) => {
                        const player = new BufferPlayer(data);
                        console.log(i++);
                        controller.append(player);
                        controller.start();
                    });

                    readable.on("close", () => {
                        console.log('close');
                        controller.append(null);
                    });
                }
            })
        })
    }

    addMenu(rect) {
        const menu = new Menu("ttsPluginTopBarMenu");
        menu.addItem({
            icon: "iconClose",
            label: this.i18n.stop,
            click: () => this.source && this.source.stop(),
        });
        menu.open({
            x: rect.right,
            y: rect.bottom,
            isLeft: true,
        });
    }
}