class FlipperSerial {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isConnected = false;
        this.responseBuffer = '';
        this.readLoopPromise = null;
        this.DEBUG = true;
        this.isReading = true;
    }
    
    isWebSerialAvailable() {
        return 'serial' in navigator;
    }

    debug(...args) {
        if (this.DEBUG) {
            console.log(...args);
        }
    }

    async connect() {
        try {
            this.debug('Requesting serial port...');
            this.port = await navigator.serial.requestPort();
            
            this.debug('Opening port...');
            await this.port.open({ baudRate: 230400 });
            
            // Start read loop first
            this.debug('Starting read loop...');
            this.reader = this.port.readable.getReader();
            this.readLoopPromise = this.readLoop(); // Changed from _readLoop to readLoop
            
            // Then get writer
            this.debug('Getting writer...');
            this.writer = this.port.writable.getWriter();
            
            // Wait a moment for the port to stabilize
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Clear any startup messages
            this.responseBuffer = '';
            
            // Try to establish CLI prompt
            this.debug('Establishing CLI prompt...');
            for (let i = 0; i < 3; i++) {
                try {
                    // Send Ctrl+C to break any existing state
                    await this.writer.write(new Uint8Array([0x03]));
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Send newline and wait for prompt
                    await this.write('\r\n');
                    await this.readUntil('>', 2000);
                    
                    this.isConnected = true;
                    this.debug('Connection established!');
                    return true;
                } catch (error) {
                    this.debug(`Prompt attempt ${i + 1} failed, retrying...`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            throw new Error('Failed to establish CLI prompt');
            
        } catch (error) {
            this.debug('Connection error:', error);
            await this.disconnect();
            throw error;
        }
    }

    async listDirectory(path) {
        if (!this.isConnected) {
            throw new Error('Not connected to Flipper');
        }
    
        try {
            // Clear buffer
            this.responseBuffer = '';
            
            // Send storage list command
            await this.write(`storage list ${path}\r\n`);
            
            // Wait for command echo
            await this.readUntil(`storage list ${path}`);
            
            // Read until prompt
            const response = await this.readUntil('>');
            console.log('Directory listing raw response:', response);
            
            // Parse the response into lines and filter out empty lines
            const files = response.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.includes('>'))
                .map(line => {
                    console.log('Processing line:', line);
                    const isDirectory = line.startsWith('[D]');
                    const isFile = line.startsWith('[F]');
                    if (!isDirectory && !isFile) return null;
                    
                    // Extract name and size for files
                    const parts = line.slice(3).trim().split(' ');
                    const name = parts[0];
                    const size = isFile ? parseInt(parts[1]) : 0;
                    
                    const fileInfo = {
                        name,
                        isDirectory,
                        path: `${path}/${name}`.replace(/\/+/g, '/'),
                        size,
                        type: isDirectory ? 'directory' : this.getFileType(name)
                    };
                    console.log('Created file info:', fileInfo);
                    return fileInfo;
                })
                .filter(file => file !== null);
                
            console.log('Parsed files:', files);
            return files;
        } catch (error) {
            this.debug('List directory failed:', error);
            throw error;
        }
    }
    
    // Helper method to determine file type
    getFileType(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const types = {
            txt: 'text',
            sub: 'subghz',
            rfid: 'rfid',
            ir: 'infrared',
            nfc: 'nfc',
            js: 'script',
            fap: 'application',
            ibtn: 'ibutton'
        };
        return types[ext] || 'unknown';
    }


    async readLoop() {
        this.debug('Starting read loop...');
        while (this.isReading) {
            try {
                const { value, done } = await this.reader.read();
                if (done || !this.isReading) {
                    this.debug('Read loop complete');
                    break;
                }
                
                const decoded = new TextDecoder().decode(value);
                this.debug('Received:', decoded);
                this.responseBuffer += decoded;
                
            } catch (error) {
                if (error.name === 'NetworkError' || !this.isReading) {
                    this.debug('Read loop breaking due to network error or stop signal');
                    break;
                }
                this.debug('Read error:', error);
                throw error;
            }
        }
        this.debug('Read loop exited');
    }

    async readUntil(marker, timeout = 5000) {
        const startTime = Date.now();
        
        while (true) {
            // Check if marker exists in current buffer
            const index = this.responseBuffer.indexOf(marker);
            if (index !== -1) {
                const response = this.responseBuffer.substring(0, index);
                this.responseBuffer = this.responseBuffer.substring(index + marker.length);
                return response.trim();
            }
            
            // Check timeout
            if (Date.now() - startTime > timeout) {
                this.debug('Timeout waiting for:', marker);
                this.debug('Buffer contents:', this.responseBuffer);
                throw new Error('Read timeout');
            }
            
            // Wait a tiny bit before next check to avoid CPU spinning
            await new Promise(resolve => setTimeout(resolve, 1));
        }
    }

    async writeFile(path, content) {
        if (!this.isConnected) {
            throw new Error('Not connected to Flipper');
        }
    
        this.debug('Starting write operation for:', path);
        
        try {
            // Clear buffer
            this.responseBuffer = '';
            
            // Create directory if needed
            const dirPath = path.substring(0, path.lastIndexOf('/'));
            if (dirPath) {
                await this.writeCommand(`storage mkdir ${dirPath}`);
            }
    
            // Start write command and wait for prompt
            this.debug('Starting storage write');
            await this.write(`storage write ${path}\r\n`);
            
            // Wait for the write prompt
            this.debug('Waiting for write prompt...');
            await this.readUntil('Just write your text data. New line by Ctrl+Enter, exit by Ctrl+C.', 5000);
            
            // Write the content
            this.debug('Writing content');
            if (content instanceof Uint8Array) {
                // Binary data
                await this.writer.write(content);
            } else {
                // Text data
                await this.write(content);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Send newline to complete content
            this.debug('Sending newline');
            await this.write('\r\n');
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Send Ctrl+C to finish write mode
            this.debug('Sending Ctrl+C');
            await this.writer.write(new Uint8Array([0x03]));
            await new Promise(resolve => setTimeout(resolve, 500));
    
            // Wait for prompt
            this.debug('Waiting for CLI prompt');
            await this.readUntil('>:', 5000);
            
            // Clear remaining output
            await new Promise(resolve => setTimeout(resolve, 200));
            this.responseBuffer = '';
            
            // Verify file exists
            this.debug('Verifying file');
            const statCmd = `storage stat ${path}`;
            await this.write(statCmd + '\r\n');
            
            await this.readUntil(statCmd);
            const statResponse = await this.readUntil('>:');
            
            if (statResponse.includes('Error') || statResponse.includes('not found')) {
                throw new Error('File verification failed');
            }
            
            return true;
        } catch (error) {
            this.debug('Write operation failed:', error);
            this.debug('Buffer contents:', this.responseBuffer);
            throw error;
        }
    }
    
    async write(data, delay = 50) {
        const encoder = new TextEncoder();
        await this.writer.write(encoder.encode(data));
        // Configurable delay after each write
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    async writeCommand(cmd) {
        if (!cmd) return;
        
        this.debug('Sending command:', cmd);
        await this.write(cmd + '\r\n');
        
        // Wait for both command echo and prompt with the exact pattern we see
        try {
            await this.readUntil(cmd, 2000);
            await this.readUntil('>:', 3000);
        } catch (error) {
            this.debug('Command response error:', error);
            throw error;
        }
    }

    async loaderList() {
        if (!this.isConnected) {
            throw new Error('Not connected to Flipper');
        }
    
        try {
            // Clear buffer
            this.responseBuffer = '';
            
            // Send loader list command
            await this.write('loader list\r\n');
            
            // Wait for command echo
            await this.readUntil('loader list');
            
            // Get response until prompt
            const response = await this.readUntil('>');
            
            // Parse available applications
            const apps = response.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.includes('>'));
                
            return apps;
        } catch (error) {
            this.debug('Loader list failed:', error);
            throw error;
        }
    }
    
    async loaderOpen(appName, filePath = null) {
        if (!this.isConnected) {
            throw new Error('Not connected to Flipper');
        }
    
        this.debug('Opening application:', appName, 'with file:', filePath);
        
        try {
            // Clear buffer
            this.responseBuffer = '';
            
            // Send loader open command with optional file path
            const command = filePath 
                ? `loader open "${appName}" "${filePath}"`
                : `loader open "${appName}"`;
                
            await this.write(command + '\r\n');
            
            // Wait for command echo
            await this.readUntil(command);
            
            // Wait for response
            const response = await this.readUntil('>');
            
            if (response.toLowerCase().includes('error')) {
                throw new Error(`Loader open failed: ${response}`);
            }
            
            return true;
        } catch (error) {
            this.debug('Loader open failed:', error);
            throw error;
        }
    }
    async loaderClose() {
        if (!this.isConnected) {
            throw new Error('Not connected to Flipper');
        }
    
        this.debug('Closing loader');
        
        try {
            // Clear buffer
            this.responseBuffer = '';
            
            // Send loader close command
            await this.write('loader close\r\n');
            
            // Wait for command echo
            await this.readUntil('loader close');
            
            // Wait for response
            const response = await this.readUntil('>');
            
            if (response.toLowerCase().includes('error')) {
                throw new Error(`Loader close failed: ${response}`);
            }
            
            return true;
        } catch (error) {
            this.debug('Loader close failed:', error);
            throw error;
        }
    }
    
    async loaderInfo() {
        if (!this.isConnected) {
            throw new Error('Not connected to Flipper');
        }
    
        try {
            // Clear buffer
            this.responseBuffer = '';
            
            // Send loader info command
            await this.write('loader info\r\n');
            
            // Wait for command echo
            await this.readUntil('loader info');
            
            // Get response until prompt
            const response = await this.readUntil('>');
            
            return response.trim();
        } catch (error) {
            this.debug('Loader info failed:', error);
            throw error;
        }
    }
    
    async loaderSignal(signal, arg = null) {
        if (!this.isConnected) {
            throw new Error('Not connected to Flipper');
        }
    
        this.debug('Sending signal:', signal, 'with arg:', arg);
        
        try {
            // Clear buffer
            this.responseBuffer = '';
            
            // Construct signal command
            const command = `loader signal ${signal}${arg ? ` ${arg}` : ''}`;
            await this.write(command + '\r\n');
            
            // Wait for command echo
            await this.readUntil(command);
            
            // Wait for response
            const response = await this.readUntil('>');
            
            if (response.toLowerCase().includes('error')) {
                throw new Error(`Signal failed: ${response}`);
            }
            
            return true;
        } catch (error) {
            this.debug('Loader signal failed:', error);
            throw error;
        }
    }
    
    // Convenience method for Bad USB
    async openBadUSB() {
        try {
            // First check if any app is running
            const info = await this.loaderInfo();
            if (info.includes('running')) {
                await this.loaderClose();
            }
            
            // Open Bad USB application
            await this.loaderOpen('Bad USB');
            return true;
        } catch (error) {
            this.debug('Bad USB open failed:', error);
            throw error;
        }
    }
    

    async disconnect() {
        this.debug('Force disconnecting...');
        
        // Immediately null everything first to prevent any new operations
        const oldPort = this.port;
        const oldReader = this.reader;
        const oldWriter = this.writer;
        
        // Clear all references immediately
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isConnected = false;
        this.isReading = false;
        this.responseBuffer = '';
        this.readLoopPromise = null;
        
        // Now clean up the old references without waiting
        try {
            if (oldReader) {
                oldReader.cancel().catch(() => {});
                oldReader.releaseLock();
            }
            if (oldWriter) {
                oldWriter.close().catch(() => {});
                oldWriter.releaseLock();
            }
            if (oldPort) {
                oldPort.close().catch(() => {});
            }
        } catch (error) {
            // Ignore any errors during cleanup
            this.debug('Cleanup errors ignored:', error);
        }
        
        this.debug('Force disconnect complete');
        return true;
    }

    // Add a new method for reading files
    async readFile(path) {
        if (!this.isConnected) {
            throw new Error('Not connected to Flipper');
        }
    
        try {
            // Clear buffer
            this.responseBuffer = '';
            
            // Send storage read command
            await this.write(`storage read ${path}\r\n`);
            
            // Wait for command echo
            await this.readUntil(`storage read ${path}`);
            
            // Skip the size line
            await this.readUntil('\n');
            
            // Read until prompt
            const content = await this.readUntil('>');
            
            return content.trim();
        } catch (error) {
            this.debug('Read file failed:', error);
            throw error;
        }
    }

    async readUntilPrompt() {
        let content = '';
        let buffer = '';
        
        while (true) {
            const chunk = await this.reader.read();
            if (chunk.done) break;
            
            buffer += new TextDecoder().decode(chunk.value);
            
            // Look for command echo and skip it
            const echoEnd = buffer.indexOf('\n');
            if (echoEnd !== -1) {
                buffer = buffer.substring(echoEnd + 1);
            }
            
            // Check for prompt
            const promptIndex = buffer.indexOf('>');
            if (promptIndex !== -1) {
                content += buffer.substring(0, promptIndex);
                break;
            }
            
            content += buffer;
            buffer = '';
        }
        
        return content.trim();
    }
}

