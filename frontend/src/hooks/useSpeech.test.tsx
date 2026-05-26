import { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useSpeech } from "./useSpeech";

function mockSpeechApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ audio_base64: "YXVkaW8=", content_type: "audio/mpeg" }),
    }))
  );
}

describe("useSpeech", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("preloads speech audio and reuses it when played", async () => {
    const audioInstances: {
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      currentTime: number;
    }[] = [];
    const createObjectURL = vi.fn(() => "blob:pronunciation");

    mockSpeechApi();
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        const instance = {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0,
        };
        audioInstances.push(instance);
        return instance;
      })
    );

    let controls!: ReturnType<typeof useSpeech>;
    function SpeechHarness() {
      controls = useSpeech(vi.fn());
      return null;
    }

    render(<SpeechHarness />);

    await act(async () => {
      await controls?.preloadSpeech("quiet");
    });
    await act(async () => {
      await controls?.playCorrect("quiet");
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(Audio).toHaveBeenCalledWith("blob:pronunciation");
    expect(audioInstances[0].play).toHaveBeenCalledTimes(1);
  });

  test("stops current speech and revokes its object URL when unmounted", async () => {
    const audioInstances: {
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      currentTime: number;
    }[] = [];
    const createObjectURL = vi.fn(() => "blob:pronunciation");
    const revokeObjectURL = vi.fn();

    mockSpeechApi();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        const instance = {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0,
        };
        audioInstances.push(instance);
        return instance;
      })
    );

    function SpeechHarness() {
      const { playCorrect } = useSpeech(vi.fn());
      useEffect(() => {
        void playCorrect("quiet");
        // Exercise the initial playback once; this test is about unmount cleanup.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    }

    const { unmount } = render(<SpeechHarness />);

    await waitFor(() => expect(audioInstances).toHaveLength(1));
    unmount();

    expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
    expect(audioInstances[0].currentTime).toBe(0);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pronunciation");
  });

  test("keeps speech active until it is stopped", async () => {
    const audioInstances: {
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      currentTime: number;
    }[] = [];

    mockSpeechApi();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:pronunciation"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        const instance = {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0,
        };
        audioInstances.push(instance);
        return instance;
      })
    );

    let controls!: ReturnType<typeof useSpeech>;
    function SpeechHarness() {
      controls = useSpeech(vi.fn());
      return null;
    }

    render(<SpeechHarness />);

    await act(async () => {
      await controls.playCorrect("quiet");
    });

    expect(controls.speakingText).toBe("quiet");
    expect(controls.speechStatus).toBe("playing");

    act(() => {
      controls.stopCurrentSpeech();
    });

    expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
    expect(audioInstances[0].currentTime).toBe(0);
    expect(controls.speakingText).toBe("");
    expect(controls.speechStatus).toBe("idle");
  });

  test("pauses and resumes current speech without resetting progress", async () => {
    const audioInstances: {
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      currentTime: number;
      duration: number;
      onended?: () => void;
    }[] = [];

    mockSpeechApi();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:pronunciation"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        const instance = {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0,
          duration: 12,
        };
        audioInstances.push(instance);
        return instance;
      })
    );

    let controls!: ReturnType<typeof useSpeech>;
    function SpeechHarness() {
      controls = useSpeech(vi.fn());
      return null;
    }

    render(<SpeechHarness />);

    await act(async () => {
      await controls.playCorrect("quiet");
    });
    audioInstances[0].currentTime = 4;

    act(() => {
      controls.pauseCurrentSpeech();
    });

    expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
    expect(audioInstances[0].currentTime).toBe(4);
    expect(controls.speakingText).toBe("quiet");
    expect(controls.speechStatus).toBe("paused");

    await act(async () => {
      await controls.playCorrect("quiet");
    });

    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].play).toHaveBeenCalledTimes(2);
    expect(audioInstances[0].currentTime).toBe(4);
    expect(controls.speechStatus).toBe("playing");

    act(() => {
      audioInstances[0].onended?.();
    });

    expect(controls.speakingText).toBe("");
    expect(controls.speechStatus).toBe("idle");
  });

  test("seeks and skips current speech playback", async () => {
    const audioInstances: {
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      currentTime: number;
      duration: number;
    }[] = [];

    mockSpeechApi();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:pronunciation"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        const instance = {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0,
          duration: 12,
        };
        audioInstances.push(instance);
        return instance;
      })
    );

    let controls!: ReturnType<typeof useSpeech>;
    function SpeechHarness() {
      controls = useSpeech(vi.fn());
      return null;
    }

    render(<SpeechHarness />);

    await act(async () => {
      await controls.playCorrect("quiet");
    });

    act(() => {
      controls.seekCurrentSpeech(10);
      controls.skipCurrentSpeech(-4);
      controls.skipCurrentSpeech(20);
    });

    expect(audioInstances[0].currentTime).toBe(12);
    expect(controls.speechCurrentTime).toBe(12);
  });

  test("does not start playback when stopped before synthesis finishes", async () => {
    let resolveSpeech!: (value: {
      ok: boolean;
      json: () => Promise<{ audio_base64: string; content_type: string }>;
    }) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveSpeech = resolve;
          })
      )
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:pronunciation"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        return {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0,
        };
      })
    );

    let controls!: ReturnType<typeof useSpeech>;
    function SpeechHarness() {
      controls = useSpeech(vi.fn());
      return null;
    }

    render(<SpeechHarness />);

    let playPromise: Promise<void>;
    act(() => {
      playPromise = controls.playCorrect("quiet");
    });
    expect(controls.speakingText).toBe("quiet");
    expect(controls.speechStatus).toBe("loading");

    act(() => {
      controls.stopCurrentSpeech();
    });

    await act(async () => {
      resolveSpeech({
        ok: true,
        json: async () => ({ audio_base64: "YXVkaW8=", content_type: "audio/mpeg" }),
      });
      await playPromise;
    });

    expect(Audio).not.toHaveBeenCalled();
    expect(controls.speakingText).toBe("");
    expect(controls.speechStatus).toBe("idle");
  });

  test("stops current speech before playing a different pronunciation", async () => {
    const audioInstances: {
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      currentTime: number;
    }[] = [];

    mockSpeechApi();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:pronunciation"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        const instance = {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0,
        };
        audioInstances.push(instance);
        return instance;
      })
    );

    let controls!: ReturnType<typeof useSpeech>;
    function SpeechHarness() {
      controls = useSpeech(vi.fn());
      return null;
    }

    render(<SpeechHarness />);

    await act(async () => {
      await controls.playCorrect("quiet");
      await controls.playCorrect("streets");
    });

    expect(audioInstances).toHaveLength(2);
    expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
    expect(audioInstances[0].currentTime).toBe(0);
    expect(audioInstances[1].play).toHaveBeenCalledTimes(1);
    expect(controls.speakingText).toBe("streets");
  });
});
