---
name: kiem-tra-don-hang
description: So đơn đặt với tồn kho, báo dòng thiếu hàng và đề xuất hàng thay thế.
---
# Kiểm tra đơn hàng

## Khi nào dùng
- Có đơn đặt mới cần xác nhận trước khi giao.

## Các bước
1. Đọc từng dòng của đơn: mã hàng, tên, số lượng.
2. So với số tồn kho hiện có của từng mã.
3. Đánh dấu dòng đủ hàng, thiếu một phần, hết hàng.
4. Với dòng thiếu, đề xuất hàng thay thế cùng nhóm (nếu có).

## Không làm
- Không tự đổi đơn của khách.
- Không hứa ngày giao, chỉ soạn nháp cho người giao việc.

## Đầu ra
- Bảng kết quả theo dòng (đủ / thiếu / hết) và danh sách đề xuất thay thế.
