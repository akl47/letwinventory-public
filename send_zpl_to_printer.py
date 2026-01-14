#!/usr/bin/env python3
"""
Simple script to send ZPL commands to a Zebra printer via TCP/IP.
Usage: python send_zpl_to_printer.py
"""

import socket

# Configuration
PRINTER_IP = "10.50.10.92"  # Change this to your printer's IP address
PRINTER_PORT = 9100  # Standard Zebra printer port

# Example ZPL string - replace with your actual ZPL
ZPL_STRING = """
^XA

^FO10,10^GFA,128,128,4,,::::::001E78,007246,01F2478,0FFBDFF,1FCE7E6827C67E6467CE7E6247FE3FE243FE7FE243FC1FC240F81F82201FFC022026240418DC3F18I042,I06E,I0C1,I081,::I0C3,I0C1,3FDCBFFC,:^FS

^FO50,20^A0N,20,20^FDLETWINVENTORY^FS
^FO493,10
^BQN,2,5
^FDMA,LOC-000000^FS
^FO500,135^A0N,17,17^FDLOC-000000^FS
^FO20,105^A0N,36,36^FDBHCS 1/4"-20x3"^FS
^CF0,23,23
^FO20,142
^FB367,2,,,
^FX 62 char limit
^FDStainless Steel, Button Head Cap Screw
^FS
^FO480,175^A0N,20,20^FDQTY: 1,000 EA^FS
^XZ
"""

def send_zpl_to_printer(zpl, printer_ip, printer_port):
    """
    Send ZPL string to printer via TCP socket.

    Args:
        zpl: ZPL command string
        printer_ip: IP address of the printer
        printer_port: Port number (usually 9100)
    """
    try:
        # Create a socket connection
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(10)  # 10 second timeout

        print(f"Connecting to printer at {printer_ip}:{printer_port}...")
        sock.connect((printer_ip, printer_port))

        print("Sending ZPL data...")
        # Send the ZPL string as bytes
        sock.send(zpl.encode('utf-8'))

        print("ZPL sent successfully!")

    except socket.timeout:
        print(f"Error: Connection to {printer_ip}:{printer_port} timed out")
    except socket.error as e:
        print(f"Socket error: {e}")
    except Exception as e:
        print(f"Unexpected error: {e}")
    finally:
        sock.close()
        print("Connection closed")

if __name__ == "__main__":
    send_zpl_to_printer(ZPL_STRING, PRINTER_IP, PRINTER_PORT)
