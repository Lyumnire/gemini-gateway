package providers

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"gemini-web-to-api/internal/commons/models"
)

type uploadedFile struct {
	ID   string
	Name string
}

// InputFilesFromAttachments decodes base64 API attachments into provider upload inputs.
func InputFilesFromAttachments(messages []models.Message) ([]InputFile, error) {
	var files []InputFile
	for _, msg := range messages {
		msgFiles, err := InputFilesFromAttachmentList(msg.Attachments)
		if err != nil {
			return nil, err
		}
		files = append(files, msgFiles...)
	}
	return files, nil
}

// InputFilesFromAttachmentList decodes base64 API attachments into provider upload inputs.
func InputFilesFromAttachmentList(attachments []models.Attachment) ([]InputFile, error) {
	files := make([]InputFile, 0, len(attachments))
	for _, attachment := range attachments {
		if strings.TrimSpace(attachment.Data) == "" {
			continue
		}
		data, err := decodeBase64Data(attachment.Data)
		if err != nil {
			return nil, fmt.Errorf("decode attachment %q: %w", attachment.Name, err)
		}
		files = append(files, InputFile{
			Name:     attachment.Name,
			MimeType: attachment.MimeType,
			Data:     data,
		})
	}
	return files, nil
}

func DecodeBase64Data(value string) ([]byte, error) {
	return decodeBase64Data(value)
}

func decodeBase64Data(value string) ([]byte, error) {
	cleaned := strings.TrimSpace(value)
	if data, err := base64.StdEncoding.DecodeString(cleaned); err == nil {
		return data, nil
	}
	if data, err := base64.RawStdEncoding.DecodeString(cleaned); err == nil {
		return data, nil
	}
	if data, err := base64.URLEncoding.DecodeString(cleaned); err == nil {
		return data, nil
	}
	return base64.RawURLEncoding.DecodeString(cleaned)
}

func (c *Client) uploadRequestFiles(ctx context.Context, cfg *GenerateConfig, cookieHdr string) ([]uploadedFile, error) {
	total := len(cfg.Files) + len(cfg.InputFiles)
	if total == 0 {
		return nil, nil
	}

	out := make([]uploadedFile, 0, total)
	for _, path := range cfg.Files {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read file %q: %w", path, err)
		}
		name := filepath.Base(path)
		mimeType := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
		if mimeType == "" {
			mimeType = http.DetectContentType(data)
		}
		uploaded, err := c.uploadFile(ctx, name, mimeType, data, cookieHdr)
		if err != nil {
			return nil, err
		}
		out = append(out, uploaded)
	}

	for i, file := range cfg.InputFiles {
		name := strings.TrimSpace(file.Name)
		if name == "" {
			name = fmt.Sprintf("input_%d%s", i+1, extensionForMimeType(file.MimeType))
		}
		mimeType := strings.TrimSpace(file.MimeType)
		if mimeType == "" {
			mimeType = http.DetectContentType(file.Data)
		}
		uploaded, err := c.uploadFile(ctx, name, mimeType, file.Data, cookieHdr)
		if err != nil {
			return nil, err
		}
		out = append(out, uploaded)
	}

	return out, nil
}

// uploadFile 使用 Google Resumable Upload 协议上传文件到 content-push.googleapis.com
// Step 1: POST /upload (resumable start) → X-Goog-Upload-URL
// Step 2: POST upload_url (upload, finalize) → 文件引用
func (c *Client) uploadFile(ctx context.Context, filename, mimeType string, data []byte, cookieHdr string) (uploadedFile, error) {
	fileSize := len(data)
	pushID := c.pushIDOrDefault()

	// Step 1: Initiate resumable upload
	req1, err := http.NewRequestWithContext(ctx, http.MethodPost, EndpointUpload, nil)
	if err != nil {
		return uploadedFile{}, fmt.Errorf("[UPLOAD] build init request: %w", err)
	}
	req1.Header.Set("Origin", "https://gemini.google.com")
	req1.Header.Set("Referer", "https://gemini.google.com/")
	req1.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req1.Header.Set("X-Tenant-Id", "bard-storage")
	req1.Header.Set("Push-ID", pushID)
	req1.Header.Set("X-Goog-Upload-Protocol", "resumable")
	req1.Header.Set("X-Goog-Upload-Command", "start")
	req1.Header.Set("X-Goog-Upload-Header-Content-Length", fmt.Sprintf("%d", fileSize))
	req1.Header.Set("X-Goog-Upload-Header-Content-Type", mimeType)
	if cookieHdr != "" {
		req1.Header.Set("Cookie", cookieHdr)
	}

	resp1, err := c.httpClient.GetClient().Do(req1)
	if err != nil {
		return uploadedFile{}, fmt.Errorf("[UPLOAD] init request failed: %w", err)
	}
	defer resp1.Body.Close()
	io.Copy(io.Discard, resp1.Body)

	if resp1.StatusCode < 200 || resp1.StatusCode >= 300 {
		return uploadedFile{}, fmt.Errorf("[UPLOAD] init failed status %d for %q", resp1.StatusCode, filename)
	}

	uploadURL := resp1.Header.Get("X-Goog-Upload-URL")
	if uploadURL == "" {
		return uploadedFile{}, fmt.Errorf("[UPLOAD] no upload URL returned for %q", filename)
	}

	// Step 2: Upload file data
	req2, err := http.NewRequestWithContext(ctx, http.MethodPost, uploadURL, bytes.NewReader(data))
	if err != nil {
		return uploadedFile{}, fmt.Errorf("[UPLOAD] build upload request: %w", err)
	}
	req2.Header.Set("Origin", "https://gemini.google.com")
	req2.Header.Set("Referer", "https://gemini.google.com/")
	req2.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req2.Header.Set("X-Goog-Upload-Command", "upload, finalize")
	req2.Header.Set("X-Goog-Upload-Offset", "0")
	req2.Header.Set("Content-Length", fmt.Sprintf("%d", fileSize))
	if cookieHdr != "" {
		req2.Header.Set("Cookie", cookieHdr)
	}

	resp2, err := c.httpClient.GetClient().Do(req2)
	if err != nil {
		return uploadedFile{}, fmt.Errorf("[UPLOAD] upload data failed: %w", err)
	}
	defer resp2.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp2.Body, 4096))
	if resp2.StatusCode < 200 || resp2.StatusCode >= 300 {
		return uploadedFile{}, fmt.Errorf("[UPLOAD] upload failed status %d for %q: %s", resp2.StatusCode, filename, strings.TrimSpace(string(respBody)))
	}

	fileRef := strings.TrimSpace(string(respBody))
	if fileRef == "" {
		return uploadedFile{}, fmt.Errorf("[UPLOAD] empty file reference for %q", filename)
	}

	return uploadedFile{ID: fileRef, Name: filename}, nil
}

func (c *Client) pushIDOrDefault() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.pushID != "" {
		return c.pushID
	}
	return "feeds/mcudyrk2a4khkz"
}

func extensionForMimeType(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ".bin"
	}
}
