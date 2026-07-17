fn eval_length(value: &str, percent_base: f32, canvas: &LayoutCanvas) -> Option<f32> {
    let mut parser = LengthParser {
        input: value.trim().as_bytes(),
        position: 0,
        percent_base,
        canvas,
    };
    let result = parser.expression()?;
    parser.skip_ws();
    (parser.position == parser.input.len() && result.is_finite()).then_some(result)
}

struct LengthParser<'a> {
    input: &'a [u8],
    position: usize,
    percent_base: f32,
    canvas: &'a LayoutCanvas,
}

impl LengthParser<'_> {
    fn expression(&mut self) -> Option<f32> {
        let mut value = self.term()?;
        loop {
            self.skip_ws();
            match self.peek() {
                Some(b'+') => {
                    self.position += 1;
                    value += self.term()?;
                }
                Some(b'-') => {
                    self.position += 1;
                    value -= self.term()?;
                }
                _ => return Some(value),
            }
        }
    }

    fn term(&mut self) -> Option<f32> {
        let mut value = self.factor()?;
        loop {
            self.skip_ws();
            match self.peek() {
                Some(b'*') => {
                    self.position += 1;
                    value *= self.factor()?;
                }
                Some(b'/') => {
                    self.position += 1;
                    value /= self.factor()?.max(f32::EPSILON);
                }
                _ => return Some(value),
            }
        }
    }

    fn factor(&mut self) -> Option<f32> {
        self.skip_ws();
        if self.peek() == Some(b'-') {
            self.position += 1;
            return Some(-self.factor()?);
        }
        if self.peek() == Some(b'(') {
            self.position += 1;
            let value = self.expression()?;
            self.skip_ws();
            self.expect(b')')?;
            return Some(value);
        }
        if self.peek()?.is_ascii_alphabetic() {
            let name = self.ident();
            self.skip_ws();
            self.expect(b'(')?;
            return match name.as_str() {
                "calc" => {
                    let v = self.expression()?;
                    self.skip_ws();
                    self.expect(b')')?;
                    Some(v)
                }
                "min" | "max" => {
                    let mut values = vec![self.expression()?];
                    while {
                        self.skip_ws();
                        self.peek() == Some(b',')
                    } {
                        self.position += 1;
                        values.push(self.expression()?);
                    }
                    self.skip_ws();
                    self.expect(b')')?;
                    if name == "min" {
                        values.into_iter().reduce(f32::min)
                    } else {
                        values.into_iter().reduce(f32::max)
                    }
                }
                "clamp" => {
                    let low = self.expression()?;
                    self.skip_ws();
                    self.expect(b',')?;
                    let preferred = self.expression()?;
                    self.skip_ws();
                    self.expect(b',')?;
                    let high = self.expression()?;
                    self.skip_ws();
                    self.expect(b')')?;
                    Some(preferred.clamp(low.min(high), low.max(high)))
                }
                _ => None,
            };
        }
        let start = self.position;
        while self.peek().is_some_and(|c| c.is_ascii_digit() || c == b'.') {
            self.position += 1;
        }
        if start == self.position {
            return None;
        }
        let number = std::str::from_utf8(&self.input[start..self.position])
            .ok()?
            .parse::<f32>()
            .ok()?;
        let unit = self.ident();
        match unit.as_str() {
            "" | "px" => Some(number),
            "%" => Some(number * self.percent_base / 100.0),
            "cqw" => Some(number * self.canvas.width / 100.0),
            "cqh" => Some(number * self.canvas.height / 100.0),
            _ => None,
        }
    }

    fn ident(&mut self) -> String {
        let start = self.position;
        while self
            .peek()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == b'%' || c == b'-')
        {
            self.position += 1;
        }
        String::from_utf8_lossy(&self.input[start..self.position]).to_ascii_lowercase()
    }
    fn peek(&self) -> Option<u8> {
        self.input.get(self.position).copied()
    }
    fn skip_ws(&mut self) {
        while self.peek().is_some_and(|c| c.is_ascii_whitespace()) {
            self.position += 1;
        }
    }
    fn expect(&mut self, expected: u8) -> Option<()> {
        (self.peek()? == expected).then(|| self.position += 1)
    }
}

