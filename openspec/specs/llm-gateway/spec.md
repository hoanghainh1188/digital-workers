# llm-gateway Specification

## Purpose
Một cửa duy nhất để gọi mô hình AI bằng API key của platform: mọi lần gọi đều được tính giá, ghi `CostEntry`, trừ credit của đúng công ty, và đổi được nhà cung cấp mà không đổi nơi gọi.

## Requirements

### Requirement: Một cửa gọi mô hình
Mọi lần gọi mô hình SHALL đi qua cổng gọi mô hình và MUST gắn với đúng một công ty (lấy từ ngữ cảnh của việc, không từ dữ liệu người dùng gửi). Code ngoài cổng này MUST NOT gọi SDK của nhà cung cấp trực tiếp.

#### Scenario: Gọi thành công
- **WHEN** công ty A có số dư 100.000đ và gọi mô hình `claude-sonnet-5-5` đã có giá
- **THEN** cổng trả kết quả của mô hình, có đúng một `CostEntry` mới thuộc công ty A và đúng một giao dịch trừ credit của công ty A

#### Scenario: Không gắn công ty
- **WHEN** một lần gọi không có công ty
- **THEN** cổng từ chối trước khi gửi gì tới nhà cung cấp

#### Scenario: Gọi SDK ngoài cổng
- **WHEN** chạy bộ test kiểm tra import
- **THEN** chỉ `packages/llm` import `ai`, `@ai-sdk/anthropic` hoặc `@ai-sdk/openai`

### Requirement: Tách công ty cho chi phí
`CostEntry` SHALL thuộc công ty của lần gọi. Người công ty A MUST NOT đọc được `CostEntry` hay giao dịch credit của công ty B.

#### Scenario: Công ty khác không thấy chi phí
- **WHEN** công ty B gọi mô hình, rồi Owner công ty A xem lịch sử credit
- **THEN** lịch sử của công ty A không có dòng nào của lần gọi đó

### Requirement: Từ chối khi hết credit
Cổng SHALL kiểm tra số dư của công ty trước mỗi lần gọi. Số dư bằng 0 hoặc âm MUST làm lần gọi bị từ chối với lỗi "công ty đã hết credit", không gửi gì tới nhà cung cấp và không tạo `CostEntry`.

#### Scenario: Số dư bằng 0
- **WHEN** công ty A có số dư 0đ và gọi mô hình
- **THEN** cổng trả lỗi hết credit, nhà cung cấp không nhận yêu cầu nào, số dư vẫn 0đ

#### Scenario: Còn credit
- **WHEN** công ty A có số dư 1đ và gọi mô hình
- **THEN** lần gọi được thực hiện và chi phí được trừ sau khi có kết quả

### Requirement: Không gọi mô hình chưa có giá
Cổng SHALL từ chối gọi một mô hình không có giá đang hiệu lực, và MUST NOT gửi yêu cầu tới nhà cung cấp trong trường hợp đó.

#### Scenario: Mô hình chưa có giá
- **WHEN** gọi mô hình `gpt-5.5-mini` trước ngày hiệu lực của giá đầu tiên của nó
- **THEN** cổng trả lỗi mô hình chưa có giá và không có `CostEntry` nào

### Requirement: Chỉ tính tiền khi có kết quả
Credit SHALL chỉ bị trừ cho lần gọi mà nhà cung cấp trả về số token đã dùng. Lần gọi lỗi trước khi có kết quả MUST NOT tạo `CostEntry` hay giao dịch trừ.

#### Scenario: Nhà cung cấp lỗi
- **WHEN** nhà cung cấp trả lỗi 500 cho lần gọi
- **THEN** cổng trả lỗi cho nơi gọi, số dư công ty không đổi và không có `CostEntry` mới

#### Scenario: Chưa cấu hình key
- **WHEN** gọi mô hình OpenAI khi chưa có API key OpenAI
- **THEN** cổng trả lỗi "nhà cung cấp chưa cấu hình", không trừ credit

### Requirement: Đổi được nhà cung cấp
Nơi gọi SHALL chọn mô hình bằng nhà cung cấp + mã mô hình, cùng một cách gọi cho Anthropic và OpenAI. Thêm nhà cung cấp mới MUST chỉ cần thêm cấu hình trong cổng, không sửa nơi gọi.

#### Scenario: Cùng một lời gọi cho hai hãng
- **WHEN** cùng một yêu cầu được gửi lần lượt tới một mô hình Anthropic và một mô hình OpenAI
- **THEN** cả hai trả kết quả cùng dạng và mỗi lần có `CostEntry` ghi đúng nhà cung cấp, mô hình

### Requirement: Mô hình giả cho test
Cổng SHALL nhận một mô hình giả thay cho nhà cung cấp thật, trả nội dung và số token định sẵn. Bộ test MUST NOT gọi API thật của nhà cung cấp.

#### Scenario: Test bằng mô hình giả
- **WHEN** test gọi cổng với mô hình giả trả 1.000 token vào và 500 token ra
- **THEN** `CostEntry` ghi đúng 1.000 token vào, 500 token ra, và không có yêu cầu mạng nào tới nhà cung cấp
