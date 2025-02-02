# Flipper WebSerial API Reference

This documentation details the usage and functionality of the `FlipperSerial` class, which enables communication with a Flipper Zero device via the browser's Web Serial API.

---

## Table of Contents

1. [Overview](#overview)
2. [Constructor](#constructor)
3. [Connection Methods](#connection-methods)
4. [File System Operations](#file-system-operations)
5. [Loader Operations](#loader-operations)
6. [Low-Level & Internal Methods](#low-level--internal-methods)
7. [Utility Methods](#utility-methods)
8. [Error Handling](#error-handling)
9. [Implementation Details](#implementation-details)

---

## Overview

The `FlipperSerial` class provides methods to connect to a Flipper Zero device using the Web Serial API, execute commands, and perform file and loader operations. All asynchronous methods return a Promise and may throw an error if an operation fails.

---

## Constructor

### `new FlipperSerial()`

Creates a new instance of the `FlipperSerial` class.

**Properties:**
- `DEBUG` (boolean): Enable/disable debug logging (default: `true`)
- `isConnected` (boolean): Indicates connection status (default: `false`)
- `isReading` (boolean): Controls the background read loop (default: `true`)

---

## Connection Methods

### `async connect()`

Establishes a connection with a Flipper Zero device.

- **Returns:** `Promise<boolean>`
- **Throws:** Error if connection fails

### `async disconnect()`

Safely disconnects from the Flipper Zero device by closing streams and releasing resources.

- **Returns:** `Promise<boolean>`

### `isWebSerialAvailable()`

Checks if the current browser supports the Web Serial API.

- **Returns:** `boolean` – `true` if the Web Serial API is available, otherwise `false`.

---

## File System Operations

### `async listDirectory(path)`

Lists the contents of a directory on the Flipper Zero.

- **Parameters:**
  - `path` (string): Directory path to list
- **Returns:** `Promise<Array<FileInfo>>`
  
  **FileInfo Structure:**
  ```javascript
  {
    name: string,
    isDirectory: boolean,
    path: string,
    size: number,      // File size in bytes (for files)
    type: string       // 'text', 'subghz', 'rfid', 'infrared', 'nfc', 'script', 'application', 'ibutton', or 'directory'
  }
  ```

### `async writeFile(path, content)`

Writes content to a file on the Flipper Zero.

- **Parameters:**
  - `path` (string): Target file path
  - `content` (string | Uint8Array): Content to write
- **Returns:** `Promise<boolean>`
- **Throws:** Error if write fails

### `async readFile(path)`

Reads the content of a file from the Flipper Zero.

- **Parameters:**
  - `path` (string): File path to read
- **Returns:** `Promise<string>`
- **Throws:** Error if read fails

---

## Loader Operations

### `async loaderList()`

Lists all available applications on the Flipper Zero.

- **Returns:** `Promise<string[]>`
- **Throws:** Error if listing fails

### `async loaderOpen(appName, filePath?)`

Opens a specified application on the Flipper Zero, optionally with a file.

- **Parameters:**
  - `appName` (string): Name of the application to open
  - `filePath` (string, optional): File path to open with the application
- **Returns:** `Promise<boolean>`
- **Throws:** Error if application fails to open

### `async loaderClose()`

Closes the currently running application.

- **Returns:** `Promise<boolean>`
- **Throws:** Error if close fails

### `async loaderInfo()`

Retrieves information about the currently running application.

- **Returns:** `Promise<string>`
- **Throws:** Error if information retrieval fails

### `async loaderSignal(signal, arg?)`

Sends a signal with an optional argument to the currently running application.

- **Parameters:**
  - `signal` (string): Signal name to send
  - `arg` (string, optional): Additional argument for the signal
- **Returns:** `Promise<boolean>`
- **Throws:** Error if the signal send fails

---

## Low-Level & Internal Methods

These methods provide granular control over communications with the device:

### `async write(data, delay = 50)`

Writes raw data to the device.

- **Parameters:**
  - `data` (string): Data to write
  - `delay` (number): Delay in milliseconds after writing (default: `50`)
- **Returns:** `Promise<void>`

### `async writeCommand(cmd)`

Sends a CLI command and awaits both its echo and the CLI prompt.

- **Parameters:**
  - `cmd` (string): Command to send
- **Returns:** `Promise<void>`

### `async readUntil(marker, timeout = 5000)`

Reads from the response buffer until a specified marker is found.

- **Parameters:**
  - `marker` (string): Text to search for in the response buffer
  - `timeout` (number): Maximum wait time in milliseconds (default: `5000`)
- **Returns:** `Promise<string>`
- **Throws:** Error if the marker is not found in time

### `async readUntilPrompt()`

Alternative method for reading responses until the CLI prompt is detected.

- **Returns:** `Promise<string>`

### `getFileType(filename)`

Determines the file type based on the file's extension.

- **Parameters:**
  - `filename` (string): Name of the file
- **Returns:** One of `'text'`, `'subghz'`, `'rfid'`, `'infrared'`, `'nfc'`, `'script'`, `'application'`, `'ibutton'`, or `'unknown'`

### `debug(...args)`

Internal utility method for logging debug information when debug mode is enabled.

- **Parameters:**
  - `...args`: Values to log

---

## Utility Methods

These methods provide additional information about the current environment or connection:

- **`isWebSerialAvailable()`** – Already documented under Connection Methods, it checks for Web Serial API support.

---

## Error Handling

All methods may throw errors with descriptive messages if an operation fails. It is recommended to wrap usage of these methods in a `try-catch` block:

```javascript
try {
    await flipperSerial.connect();
    // ... further operations ...
} catch (error) {
    console.error('Operation failed:', error.message);
}
```

---

## Implementation Details

- **Response Buffer:**  
  The API maintains an internal response buffer that accumulates data from the device. Methods such as `readUntil` and `readUntilPrompt` consume this buffer to extract responses.

- **Read Loop:**  
  A continuous read loop runs in the background while connected, populating the response buffer with data. This strategy facilitates asynchronous reading of incoming data.

---
