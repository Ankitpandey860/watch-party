// Characterization tests for components/VideoInput/VideoInput.jsx.
import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoInput } from "./VideoInput";

const button = () => screen.getByRole("button", { name: /change video/i });
const box = () => screen.getByLabelText(/video link/i);

describe("VideoInput", () => {
  test("starts empty with the submit button disabled and no error", () => {
    render(<VideoInput onChangeVideo={vi.fn()} />);
    expect(button()).toBeDisabled();
    expect(screen.queryByText(/enter a valid youtube link or video id/i)).not.toBeInTheDocument();
  });

  test("an invalid, non-empty value shows an error and keeps the button disabled", async () => {
    render(<VideoInput onChangeVideo={vi.fn()} />);
    await userEvent.type(box(), "https://vimeo.com/123");
    expect(screen.getByText(/enter a valid youtube link or video id/i)).toBeInTheDocument();
    expect(button()).toBeDisabled();
  });

  test("a valid URL enables the button; submitting passes the RAW URL (not the id) to onChangeVideo", async () => {
    const onChangeVideo = vi.fn();
    render(<VideoInput onChangeVideo={onChangeVideo} />);
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    await userEvent.type(box(), url);
    expect(button()).toBeEnabled();
    await userEvent.click(button());
    expect(onChangeVideo).toHaveBeenCalledTimes(1);
    expect(onChangeVideo).toHaveBeenCalledWith(url);
  });

  test("pressing Enter in the field submits a valid URL", async () => {
    const onChangeVideo = vi.fn();
    render(<VideoInput onChangeVideo={onChangeVideo} />);
    await userEvent.type(box(), "https://youtu.be/dQw4w9WgXcQ{Enter}");
    expect(onChangeVideo).toHaveBeenCalledWith("https://youtu.be/dQw4w9WgXcQ");
  });

  test("a bare 11-char video id is accepted (matches what the server accepts)", async () => {
    const onChangeVideo = vi.fn();
    render(<VideoInput onChangeVideo={onChangeVideo} />);
    await userEvent.type(box(), "dQw4w9WgXcQ");
    expect(button()).toBeEnabled();
    await userEvent.click(button());
    expect(onChangeVideo).toHaveBeenCalledWith("dQw4w9WgXcQ");
  });

  test("lookalike domains and other providers are rejected", async () => {
    render(<VideoInput onChangeVideo={vi.fn()} />);
    await userEvent.type(box(), "https://notyoutube.com/watch?v=dQw4w9WgXcQ");
    expect(button()).toBeDisabled();
  });

  test("disabled: input and button are disabled and a role notice is shown", () => {
    render(<VideoInput disabled onChangeVideo={vi.fn()} />);
    expect(box()).toBeDisabled();
    expect(button()).toBeDisabled();
    expect(screen.getByText(/only host & moderators/i)).toBeInTheDocument();
  });
});
