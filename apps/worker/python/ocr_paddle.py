import sys
import os

# Set standard output encoding to utf-8 in case of special characters
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def main():
    if len(sys.argv) < 2:
        print("Usage: python ocr_paddle.py <image_path> [lang]")
        sys.exit(1)
        
    image_path = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else 'en'
    
    if not os.path.exists(image_path):
        print(f"Error: Image path '{image_path}' does not exist.", file=sys.stderr)
        sys.exit(1)

    try:
        from paddleocr import PaddleOCR
    except ImportError as e:
        print("Error: paddleocr module is not installed. Please install 'paddlepaddle' and 'paddleocr'.", file=sys.stderr)
        sys.exit(1)
        
    # Disable Paddle Logging to avoid polluting stdout
    ocr = PaddleOCR(use_angle_cls=True, lang=lang, show_log=False)
    result = ocr.ocr(image_path, cls=True)
    
    if not result:
        return
        
    # result is a list of lists of [box, (text, confidence)]
    texts = []
    for line in result:
        if not line:
            continue
        for res in line:
            texts.append(res[1][0])
            
    print("\n".join(texts))

if __name__ == "__main__":
    main()
