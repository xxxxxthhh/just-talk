import { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
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
});
