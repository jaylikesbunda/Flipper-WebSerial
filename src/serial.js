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
            
            this.reader = this.port.readable.getReader();
            this.readLoopPromise = this.readLoop();
            
            this.debug('Getting writer...');
            this.writer = this.port.writable.getWriter();
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            this.responseBuffer = '';
            
            // try cli handshake 3 times
            for (let i = 0; i < 3; i++) {
                try {
                    await this.writer.write(new Uint8Array([0x03]));
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
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
            this.responseBuffer = '';
            
            await this.write(`storage list ${path}\r\n`);
            await this.readUntil(`storage list ${path}`);
            
            const response = await this.readUntil('>');
            console.log('Directory listing raw response:', response);
            
            const files = response.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.includes('>'))
                .map(line => {
                    console.log('Processing line:', line);
                    const isDirectory = line.startsWith('[D]');
                    const isFile = line.startsWith('[F]');
                    if (!isDirectory && !isFile) return null;
                    
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
            const index = this.responseBuffer.indexOf(marker);
            if (index !== -1) {
                const response = this.responseBuffer.substring(0, index);
                this.responseBuffer = this.responseBuffer.substring(index + marker.length);
                return response.trim();
            }
            
            if (Date.now() - startTime > timeout) {
                this.debug('Timeout waiting for:', marker);
                this.debug('Buffer contents:', this.responseBuffer);
                throw new Error('Read timeout');
            }
            
            await new Promise(resolve => setTimeout(resolve, 1));
        }
    }

    async writeFile(path, content) {
        if (!this.isConnected) throw new Error('Not connected to Flipper');

        try {
            this.responseBuffer = '';
            
            const dirPath = path.substring(0, path.lastIndexOf('/'));
            if (dirPath) {
                await this.writeCommand(`storage mkdir ${dirPath}`);
            }
    
            this.debug('Starting storage write');
            await this.write(`storage write ${path}\r\n`);
            
            this.debug('Waiting for write prompt...');
            await this.readUntil('Just write your text data. New line by Ctrl+Enter, exit by Ctrl+C.', 5000);
            
            this.debug('Writing content');
            if (content instanceof Uint8Array) {
                await this.writer.write(content);
            } else {
                await this.write(content);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            
            this.debug('Sending newline');
            await this.write('\r\n');
            await new Promise(resolve => setTimeout(resolve, 200));
            
            this.debug('Sending Ctrl+C');
            await this.writer.write(new Uint8Array([0x03]));
            await new Promise(resolve => setTimeout(resolve, 500));
    
            this.debug('Waiting for CLI prompt');
            await this.readUntil('>:', 5000);
            
            await new Promise(resolve => setTimeout(resolve, 200));
            this.responseBuffer = '';
            
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
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    async writeCommand(cmd) {
        if (!cmd) return;
        
        this.debug('Sending command:', cmd);
        await this.write(cmd + '\r\n');
        
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
            this.responseBuffer = '';
            await this.write('loader list\r\n');
            await this.readUntil('loader list');
            
            const response = await this.readUntil('>');
            
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
            this.responseBuffer = '';
            
            const command = filePath 
                ? `loader open "${appName}" "${filePath}"`
                : `loader open "${appName}"`;
                
            await this.write(command + '\r\n');
            await this.readUntil(command);
            
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
            this.responseBuffer = '';
            await this.write('loader close\r\n');
            await this.readUntil('loader close');
            
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
            this.responseBuffer = '';
            await this.write('loader info\r\n');
            await this.readUntil('loader info');
            
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
            this.responseBuffer = '';
            
            const command = `loader signal ${signal}${arg ? ` ${arg}` : ''}`;
            await this.write(command + '\r\n');
            await this.readUntil(command);
            
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
    
    async openBadUSB() {
        try {
            const info = await this.loaderInfo();
            if (info.includes('running')) {
                await this.loaderClose();
            }
            
            await this.loaderOpen('Bad USB');
            return true;
        } catch (error) {
            this.debug('Bad USB open failed:', error);
            throw error;
        }
    }
    

    async disconnect() {
        this.debug('Force disconnecting...');
        
        const oldPort = this.port;
        const oldReader = this.reader;
        const oldWriter = this.writer;
        
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isConnected = false;
        this.isReading = false;
        this.responseBuffer = '';
        this.readLoopPromise = null;
        
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
            this.debug('Cleanup errors ignored:', error);
        }
        
        this.debug('Force disconnect complete');
        return true;
    }

    async readFile(path) {
        if (!this.isConnected) {
            throw new Error('Not connected to Flipper');
        }
    
        try {
            this.responseBuffer = '';
            await this.write(`storage read ${path}\r\n`);
            await this.readUntil(`storage read ${path}`);
            await this.readUntil('\n');
            
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
            
            const echoEnd = buffer.indexOf('\n');
            if (echoEnd !== -1) {
                buffer = buffer.substring(echoEnd + 1);
            }
            
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
